"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  authenticateWithPasskey,
  registerPasskey,
} from "@/lib/security/webauthn-browser";

type Phase =
  | "credentials"
  | "totp-enrollment"
  | "totp-verification"
  | "totp-recovery"
  | "passkey-enrollment"
  | "passkey-verification"
  | "complete";

type Enrollment = {
  qrCodeDataUrl: string;
  manualEntryKey: string;
};

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The authentication service returned an invalid response.");
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Authentication request failed.";
    throw new Error(message);
  }
  return payload as T;
}

export function LoginFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("credentials");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (phase === "credentials") {
        await postJson("/api/auth/login", { identifier, password });
        const next = await postJson<{ nextFactor: string }>("/api/totp/challenge");
        if (next.nextFactor === "totp") {
          setPhase("totp-verification");
          setMessage("Enter the current 6-digit code from your authenticator app.");
        } else {
          const setup = await postJson<Enrollment>("/api/totp/enroll");
          setEnrollment(setup);
          setPhase("totp-enrollment");
          setMessage("Scan this QR code with an authenticator app, then enter its 6-digit code.");
        }
      } else if (
        phase === "totp-enrollment" ||
        phase === "totp-verification" ||
        phase === "totp-recovery"
      ) {
        const path =
          phase === "totp-enrollment"
            ? "/api/totp/verify-enrollment"
            : phase === "totp-recovery"
              ? "/api/totp/recover"
              : "/api/totp/verify";
        const result = await postJson<{
          nextFactor?: "webauthn_authentication" | "webauthn_registration";
          recoveryCodes?: string[];
          recoveryCodeUsed?: boolean;
        }>(
          path,
          phase === "totp-recovery"
            ? { recoveryCode: code }
            : { token: code },
        );
        setCode("");
        if (result.recoveryCodes) {
          setRecoveryCodes(result.recoveryCodes);
          setPhase("passkey-enrollment");
          setMessage("Save these one-time recovery codes somewhere safe before continuing.");
        } else {
          const needsRegistration =
            result.nextFactor === "webauthn_registration";
          setPhase(needsRegistration ? "passkey-enrollment" : "passkey-verification");
          setMessage(
            result.recoveryCodeUsed
              ? needsRegistration
                ? "Recovery code accepted. Register a passkey to finish setting up this account."
                : "Recovery code accepted. Continue with your registered passkey."
              : needsRegistration
                ? "TOTP verified. Register a passkey to finish setting up this account."
                : "TOTP verified. Continue with your registered passkey.",
          );
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function finishWithPasskey(register: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (register) {
        await registerPasskey();
      } else {
        await authenticateWithPasskey();
      }
      const completion = await postJson<{
        factorsVerified: boolean;
        sessionIssued: boolean;
        redirectTo: string;
      }>("/api/auth/complete");
      if (!completion.factorsVerified || !completion.sessionIssued) {
        throw new Error("Authentication did not complete as expected.");
      }
      setPhase("complete");
      setMessage("All three factors verified. Redirecting to your portal…");
      router.replace(completion.redirectTo);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Passkey verification failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-flow">
      <div className="factor-steps" aria-label="Three-factor sign-in progress">
        <span className={`factor-step ${phase === "credentials" ? "active" : "done"}`}>1 · Password</span>
        <span className={`factor-step ${phase.startsWith("totp") ? "active" : phase.startsWith("passkey") || phase === "complete" ? "done" : ""}`}>2 · Authenticator</span>
        <span className={`factor-step ${phase.startsWith("passkey") ? "active" : phase === "complete" ? "done" : ""}`}>3 · Passkey</span>
      </div>
      {phase === "credentials" && (
        <form onSubmit={submit}>
          <label className="auth-label" htmlFor="student-id">Registration number or university email</label>
          <input
            className="auth-input"
            id="student-id"
            autoComplete="username"
            placeholder="e.g. STJ/2025/00123"
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
          <label className="auth-label" htmlFor="password">Password</label>
          <input
            className="auth-input"
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="button button-primary auth-button" type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Continue"} <span aria-hidden="true">→</span>
          </button>
        </form>
      )}
      {phase === "totp-enrollment" && enrollment && (
        <form onSubmit={submit}>
          <p className="flow-instruction">Scan using Google Authenticator, Microsoft Authenticator, or another TOTP app.</p>
          {/* This QR encodes the secret only for first-time authenticator enrollment. */}
          <Image
            className="totp-qr"
            src={enrollment.qrCodeDataUrl}
            alt="Authenticator enrollment QR code"
            width={192}
            height={192}
            unoptimized
          />
          <p className="manual-key"><span>Manual entry key</span><code>{enrollment.manualEntryKey}</code></p>
          <label className="auth-label" htmlFor="enroll-code">6-digit authenticator code</label>
          <input
            className="auth-input code-input"
            id="enroll-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button className="button button-primary auth-button" type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Verify authenticator"}
          </button>
        </form>
      )}
      {phase === "totp-verification" && (
        <>
          <form onSubmit={submit}>
            <label className="auth-label" htmlFor="otp-code">6-digit authenticator code</label>
            <input
              className="auth-input code-input"
              id="otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button className="button button-primary auth-button" type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Verify code"}
            </button>
          </form>
          <button className="recovery-link" type="button" onClick={() => { setCode(""); setError(""); setPhase("totp-recovery"); }}>
            Lost access to your authenticator? Use a recovery code
          </button>
        </>
      )}
      {phase === "totp-recovery" && (
        <form onSubmit={submit}>
          <p className="flow-instruction">Each recovery code works once. Using one will invalidate it.</p>
          <label className="auth-label" htmlFor="recovery-code">Saved recovery code</label>
          <input
            className="auth-input"
            id="recovery-code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            maxLength={12}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12))}
          />
          <button className="button button-primary auth-button" type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Use recovery code"}
          </button>
          <button className="recovery-link" type="button" onClick={() => { setCode(""); setError(""); setPhase("totp-verification"); }}>
            Back to authenticator code
          </button>
        </form>
      )}
      {(phase === "passkey-enrollment" || phase === "passkey-verification") && (
        <div>
          {recoveryCodes.length > 0 && (
            <section className="recovery-codes" aria-label="One-time recovery codes">
              <strong>Recovery codes — shown once</strong>
              <div>{recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}</div>
              <label className="recovery-confirm">
                <input
                  type="checkbox"
                  checked={recoveryCodesSaved}
                  onChange={(event) => setRecoveryCodesSaved(event.target.checked)}
                />
                I have saved these recovery codes
              </label>
            </section>
          )}
          <p className="flow-instruction">
            Your device may verify you with a fingerprint, face recognition, or its PIN. The university never receives biometric data.
          </p>
          <button
            className="button button-primary auth-button"
            type="button"
            disabled={busy || (phase === "passkey-enrollment" && recoveryCodes.length > 0 && !recoveryCodesSaved)}
            onClick={() => void finishWithPasskey(phase === "passkey-enrollment")}
          >
            {busy ? "Waiting for your device…" : phase === "passkey-enrollment" ? "Register this device" : "Verify with passkey"}
          </button>
        </div>
      )}
      {phase === "complete" && (
        <div className="flow-complete" role="status">
          <strong>Three factors verified</strong>
          <p>Your secure session is ready. Redirecting to your university portal.</p>
        </div>
      )}
      {message && <p className="flow-message" role="status">{message}</p>}
      {error && <p className="flow-error" role="alert">{error}</p>}
      <p className="flow-disclaimer">
        Sign-in requires the university-issued account, an authenticator app, and a registered passkey. All backend configuration and migrations must be completed before use.
      </p>
    </div>
  );
}
