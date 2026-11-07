import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import {
  hasAttemptsRemaining,
  isTotpStepFresh,
  nextWebAuthnFactor,
} from "@/lib/auth/policies";
import { AUTH_TRANSACTION_TTL_SECONDS } from "@/lib/auth/transaction";

const ISSUER = "St Jude University";
const PERIOD_SECONDS = 30;
const MAX_ATTEMPTS = 5;

export class TotpServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotpServiceError";
  }
}

type Factor =
  | "PASSWORD_TRANSACTION"
  | "TOTP"
  | "WEBAUTHN_REGISTRATION"
  | "WEBAUTHN_AUTHENTICATION";

function getEncryptionKey() {
  const encoded = process.env.TOTP_ENCRYPTION_KEY;
  if (!encoded) {
    throw new SupabaseConfigurationError(
      "Set TOTP_ENCRYPTION_KEY to a base64-encoded 32-byte key.",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new SupabaseConfigurationError(
      "TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }
  return key;
}

function recoveryHash(code: string) {
  const key = process.env.TOTP_RECOVERY_HASH_KEY;
  if (!key || key.length < 32) {
    throw new SupabaseConfigurationError(
      "Set TOTP_RECOVERY_HASH_KEY to a random secret of at least 32 characters.",
    );
  }
  return createHmac("sha256", key).update(code).digest("hex");
}

export function hashTransactionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(value: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new TotpServiceError("Stored authenticator secret has an unknown format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function findActiveTransaction(token: string) {
  const admin = getSupabaseAdminClient();
  const { data: challenge, error } = await admin
    .from("authentication_challenges")
    .select("id, auth_transaction_id, user_id, factor, expires_at, failed_attempts")
    .eq("challenge_hash", hashTransactionToken(token))
    .in("factor", [
      "PASSWORD_TRANSACTION",
      "TOTP",
      "WEBAUTHN_REGISTRATION",
      "WEBAUTHN_AUTHENTICATION",
    ])
    .is("consumed_at", null)
    .maybeSingle();
  if (error) {
    throw new TotpServiceError("Could not load the authentication transaction.");
  }
  if (
    !challenge?.user_id ||
    !Number.isFinite(new Date(challenge.expires_at).getTime()) ||
    new Date(challenge.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }
  return { admin, challenge };
}

async function issueTransaction(
  userId: string,
  factor: Factor,
  transactionId = randomUUID(),
  expiresAt?: string,
) {
  const admin = getSupabaseAdminClient();
  const token = randomBytes(32).toString("base64url");
  const { error } = await admin.from("authentication_challenges").insert({
    auth_transaction_id: transactionId,
    user_id: userId,
    factor,
    challenge_hash: hashTransactionToken(token),
    expires_at:
      expiresAt ??
      new Date(Date.now() + AUTH_TRANSACTION_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) {
    throw new TotpServiceError("Could not create the next authentication transaction.");
  }
  return token;
}

async function consumeChallenge(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  id: string,
  verified = true,
) {
  const { data, error } = await admin.rpc("consume_authentication_challenge", {
    _challenge_id: id,
    _verified: verified,
  });
  if (error) {
    throw new TotpServiceError(
      `Could not consume the authentication challenge (database error ${error.code ?? "unknown"}).`,
    );
  }
  return data === true;
}

export async function beginTotpChallenge(transactionToken: string) {
  const transaction = await findActiveTransaction(transactionToken);
  if (!transaction) return { kind: "expired" as const };
  const { admin, challenge } = transaction;
  if (challenge.factor !== "PASSWORD_TRANSACTION") {
    return { kind: "invalid" as const };
  }

  const { data: credential, error } = await admin
    .from("totp_credentials")
    .select("is_enabled")
    .eq("user_id", challenge.user_id)
    .maybeSingle();
  if (error) throw new TotpServiceError("Could not check the authenticator state.");
  if (!credential?.is_enabled) return { kind: "enrollment_required" as const };

  const nextToken = await issueTransaction(
    challenge.user_id,
    "TOTP",
    challenge.auth_transaction_id,
    challenge.expires_at,
  );
  if (!(await consumeChallenge(admin, challenge.id))) {
    const { error: cleanupError } = await admin
      .from("authentication_challenges")
      .delete()
      .eq("challenge_hash", hashTransactionToken(nextToken));
    if (cleanupError) {
      throw new TotpServiceError("Could not clean up an unused TOTP challenge.");
    }
    return { kind: "expired" as const };
  }
  return { kind: "challenge" as const, transactionToken: nextToken };
}

export async function beginTotpEnrollment(transactionToken: string, label: string) {
  const transaction = await findActiveTransaction(transactionToken);
  if (!transaction) return { kind: "expired" as const };
  const { admin, challenge } = transaction;
  if (challenge.factor !== "PASSWORD_TRANSACTION") {
    return { kind: "invalid" as const };
  }

  const { data: current, error: lookupError } = await admin
    .from("totp_credentials")
    .select("is_enabled")
    .eq("user_id", challenge.user_id)
    .maybeSingle();
  if (lookupError) throw new TotpServiceError("Could not check authenticator enrollment.");
  if (current?.is_enabled) return { kind: "already_enrolled" as const };

  const secret = generateSecret({ length: 20 });
  const uri = generateURI({ issuer: ISSUER, label, secret, digits: 6, period: PERIOD_SECONDS });
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 256 });
  const { error: saveError } = await admin.from("totp_credentials").upsert(
    {
      user_id: challenge.user_id,
      secret_ciphertext: encryptSecret(secret),
      encryption_key_version: 1,
      recovery_code_hashes: [],
      is_enabled: false,
      enabled_at: null,
      enrollment_expires_at: challenge.expires_at,
    },
    { onConflict: "user_id" },
  );
  if (saveError) {
    throw new TotpServiceError("Could not store the pending authenticator enrollment.");
  }
  return { kind: "ready" as const, qrDataUrl, manualEntryKey: secret };
}

async function checkTotp(token: string, secret: string, lastStep: number | null) {
  const currentStep = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  const result = await verify({
    secret,
    token,
    digits: 6,
    period: PERIOD_SECONDS,
    epochTolerance: [30, 0],
  });
  if (!result.valid || result.delta === undefined || result.delta > 0) {
    return { kind: "invalid" as const };
  }
  const verifiedStep = currentStep + result.delta;
  if (!isTotpStepFresh(verifiedStep, lastStep)) {
    return { kind: "replayed" as const };
  }
  return { kind: "verified" as const, verifiedStep };
}

export async function verifyTotpEnrollment(transactionToken: string, token: string) {
  const transaction = await findActiveTransaction(transactionToken);
  if (!transaction) return { kind: "expired" as const };
  const { admin, challenge } = transaction;
  if (challenge.factor !== "PASSWORD_TRANSACTION") {
    return { kind: "invalid" as const };
  }
  if (!hasAttemptsRemaining(challenge.failed_attempts, MAX_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }

  const { data: credential, error } = await admin
    .from("totp_credentials")
    .select("secret_ciphertext, is_enabled, enrollment_expires_at")
    .eq("user_id", challenge.user_id)
    .maybeSingle();
  if (error) throw new TotpServiceError("Could not load the pending authenticator.");
  if (
    !credential ||
    credential.is_enabled ||
    !credential.enrollment_expires_at ||
    new Date(credential.enrollment_expires_at).getTime() <= Date.now()
  ) {
    return { kind: "invalid" as const };
  }

  const checked = await checkTotp(token, decryptSecret(credential.secret_ciphertext), null);
  if (checked.kind !== "verified") {
    const { error: attemptError } = await admin
      .from("authentication_challenges")
      .update({ failed_attempts: challenge.failed_attempts + 1 })
      .eq("id", challenge.id)
      .is("consumed_at", null);
    if (attemptError) throw new TotpServiceError("Could not record an enrollment attempt.");
    return checked;
  }

  const recoveryCodes = Array.from({ length: 10 }, () =>
    randomBytes(9).toString("base64url").toUpperCase(),
  );
  const nextToken = randomBytes(32).toString("base64url");
  const { data: completed, error: completionError } = await admin.rpc(
    "complete_totp_enrollment",
    {
      _password_challenge_id: challenge.id,
      _verified_step: checked.verifiedStep,
      _recovery_code_hashes: recoveryCodes.map(recoveryHash),
      _totp_marker_hash: hashTransactionToken(randomBytes(32).toString("base64url")),
      _webauthn_transaction_hash: hashTransactionToken(nextToken),
    },
  );
  if (completionError) {
    throw new TotpServiceError(
      `Could not complete authenticator enrollment (database error ${completionError.code ?? "unknown"}).`,
    );
  }
  if (completed !== true) return { kind: "expired" as const };
  return { kind: "verified" as const, recoveryCodes, transactionToken: nextToken };
}

export async function verifyTotpChallenge(transactionToken: string, token: string) {
  const transaction = await findActiveTransaction(transactionToken);
  if (!transaction) return { kind: "expired" as const };
  const { admin, challenge } = transaction;
  if (challenge.factor !== "TOTP") return { kind: "invalid" as const };
  if (!hasAttemptsRemaining(challenge.failed_attempts, MAX_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }

  const { data: credential, error } = await admin
    .from("totp_credentials")
    .select("secret_ciphertext, is_enabled, last_verified_step")
    .eq("user_id", challenge.user_id)
    .maybeSingle();
  if (error) throw new TotpServiceError("Could not load the authenticator credential.");
  if (!credential?.is_enabled) return { kind: "invalid" as const };

  const checked = await checkTotp(
    token,
    decryptSecret(credential.secret_ciphertext),
    credential.last_verified_step,
  );
  if (checked.kind !== "verified") {
    if (checked.kind === "invalid") {
      const { error: attemptError } = await admin
        .from("authentication_challenges")
        .update({ failed_attempts: challenge.failed_attempts + 1 })
        .eq("id", challenge.id)
        .is("consumed_at", null);
      if (attemptError) throw new TotpServiceError("Could not record a TOTP attempt.");
    }
    return checked;
  }

  let update = admin
    .from("totp_credentials")
    .update({ last_verified_step: checked.verifiedStep })
    .eq("user_id", challenge.user_id);
  update =
    credential.last_verified_step === null
      ? update.is("last_verified_step", null)
      : update.eq("last_verified_step", credential.last_verified_step);
  const { data: updated, error: updateError } = await update
    .select("user_id")
    .maybeSingle();
  if (updateError) throw new TotpServiceError("Could not apply TOTP replay protection.");
  if (!updated) return { kind: "replayed" as const };
  if (!(await consumeChallenge(admin, challenge.id))) {
    return { kind: "replayed" as const };
  }

  const { count, error: credentialError } = await admin
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", challenge.user_id);
  if (credentialError) {
    throw new TotpServiceError("Could not check the account passkey state.");
  }
  const nextFactor = nextWebAuthnFactor(count ?? 0);
  const nextToken = await issueTransaction(
    challenge.user_id,
    nextFactor,
    challenge.auth_transaction_id,
    challenge.expires_at,
  );
  return { kind: "verified" as const, nextFactor, transactionToken: nextToken };
}

export async function verifyTotpRecoveryCode(
  transactionToken: string,
  recoveryCode: string,
) {
  const transaction = await findActiveTransaction(transactionToken);
  if (!transaction) return { kind: "expired" as const };
  const { admin, challenge } = transaction;
  if (challenge.factor !== "TOTP") return { kind: "invalid" as const };
  if (!hasAttemptsRemaining(challenge.failed_attempts, MAX_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }

  const nextToken = randomBytes(32).toString("base64url");
  const { data, error } = await admin.rpc("consume_totp_recovery_code", {
    _challenge_id: challenge.id,
    _code_hash: recoveryHash(recoveryCode),
    _next_transaction_hash: hashTransactionToken(nextToken),
  });
  if (error) {
    throw new TotpServiceError(
      `Could not verify the recovery code (database error ${error.code ?? "unknown"}).`,
    );
  }

  const result = data?.[0];
  if (!result || result.outcome === "invalid") {
    return { kind: "invalid" as const };
  }
  if (result.outcome === "expired") return { kind: "expired" as const };
  if (result.outcome === "rate_limited") return { kind: "rate_limited" as const };
  if (result.outcome !== "verified") {
    throw new TotpServiceError("Recovery code verification returned an invalid state.");
  }
  if (
    result.next_factor !== "WEBAUTHN_REGISTRATION" &&
    result.next_factor !== "WEBAUTHN_AUTHENTICATION"
  ) {
    throw new TotpServiceError("Recovery code verification returned an invalid next factor.");
  }

  return {
    kind: "verified" as const,
    nextFactor: result.next_factor,
    transactionToken: nextToken,
  };
}

export function getTotpTransactionCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-stj-auth-tx"
    : "stj-auth-tx";
}

export function getTotpCookieSettings() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: AUTH_TRANSACTION_TTL_SECONDS,
  };
}
