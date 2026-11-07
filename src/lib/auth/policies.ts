import type { AppRole } from "@/lib/auth/session";

export type VerifiedFactor = {
  factor: string;
  verified_at: string | null;
  consumed_at: string | null;
};

export function roleCanAccess(role: AppRole, allowedRoles: readonly AppRole[]) {
  return allowedRoles.includes(role);
}

export function isAppSessionActive(
  expiresAt: string,
  revokedAt: string | null,
  now = Date.now(),
) {
  const expiry = new Date(expiresAt).getTime();
  return revokedAt === null && Number.isFinite(expiry) && expiry > now;
}

export function hasAttemptsRemaining(attempts: number, maximum: number) {
  return Number.isInteger(attempts) && attempts >= 0 && attempts < maximum;
}

export function isTotpStepFresh(verifiedStep: number, lastVerifiedStep: number | null) {
  return (
    Number.isInteger(verifiedStep) &&
    verifiedStep >= 0 &&
    (lastVerifiedStep === null || verifiedStep > lastVerifiedStep)
  );
}

export function nextWebAuthnFactor(registeredCredentialCount: number) {
  return registeredCredentialCount > 0
    ? "WEBAUTHN_AUTHENTICATION" as const
    : "WEBAUTHN_REGISTRATION" as const;
}

export function hasCompleteAuthenticationSequence(factors: VerifiedFactor[]) {
  if (factors.length !== 3) return false;
  const password = factors.filter((item) => item.factor === "PASSWORD_TRANSACTION");
  const totp = factors.filter((item) => item.factor === "TOTP");
  const webauthn = factors.filter((item) =>
    item.factor === "WEBAUTHN_REGISTRATION" ||
    item.factor === "WEBAUTHN_AUTHENTICATION"
  );
  if (password.length !== 1 || totp.length !== 1 || webauthn.length !== 1) {
    return false;
  }

  const times = [password[0], totp[0], webauthn[0]].map((factor) => {
    if (!factor.verified_at || !factor.consumed_at) return Number.NaN;
    return new Date(factor.verified_at).getTime();
  });
  return (
    times.every(Number.isFinite) &&
    times[0] <= times[1] &&
    times[1] <= times[2]
  );
}
