import "server-only";
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { hashTransactionToken } from "@/lib/security/totp";
import { hasAttemptsRemaining } from "@/lib/auth/policies";
const MAX_WEBAUTHN_ATTEMPTS = 5;

export class WebAuthnServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnServiceError";
  }
}

function getRelyingPartyConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID;
  const origin = process.env.WEBAUTHN_ORIGIN;
  if (!rpID || !origin) {
    throw new SupabaseConfigurationError(
      "Set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN for passkey verification.",
    );
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new SupabaseConfigurationError("WEBAUTHN_ORIGIN must be a valid absolute URL.");
  }

  if (
    (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") ||
    (process.env.NODE_ENV === "production" && parsedOrigin.protocol !== "https:")
  ) {
    throw new SupabaseConfigurationError(
      "WebAuthn must use HTTPS in production; HTTP is only permitted for local development.",
    );
  }
  if (parsedOrigin.hostname !== rpID && !parsedOrigin.hostname.endsWith(`.${rpID}`)) {
    throw new SupabaseConfigurationError(
      "WEBAUTHN_RP_ID must match WEBAUTHN_ORIGIN's hostname or a parent domain.",
    );
  }
  return { rpID, origin: parsedOrigin.origin };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) return false;
  const response = value.response;
  return (
    value.type === "public-key" &&
    typeof value.id === "string" &&
    typeof value.rawId === "string" &&
    typeof response.clientDataJSON === "string" &&
    typeof response.attestationObject === "string" &&
    isRecord(value.clientExtensionResults)
  );
}

function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) return false;
  const response = value.response;
  return (
    value.type === "public-key" &&
    typeof value.id === "string" &&
    typeof value.rawId === "string" &&
    typeof response.clientDataJSON === "string" &&
    typeof response.authenticatorData === "string" &&
    typeof response.signature === "string" &&
    isRecord(value.clientExtensionResults)
  );
}

function getTransactionCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-stj-auth-tx"
    : "stj-auth-tx";
}

async function findWebAuthnTransaction(token: string, factor: string) {
  const admin = getSupabaseAdminClient();
  const { data: transaction, error } = await admin
    .from("authentication_challenges")
    .select("id, auth_transaction_id, user_id, webauthn_challenge, expires_at, failed_attempts")
    .eq("challenge_hash", hashTransactionToken(token))
    .eq("factor", factor)
    .is("consumed_at", null)
    .maybeSingle();

  if (error) throw new WebAuthnServiceError("Could not load the WebAuthn transaction.");
  if (
    !transaction?.user_id ||
    !Number.isFinite(new Date(transaction.expires_at).getTime()) ||
    new Date(transaction.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }
  return { admin, transaction };
}

async function saveChallenge(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  id: string,
  challenge: string,
) {
  const { data, error } = await admin
    .from("authentication_challenges")
    .update({ webauthn_challenge: challenge })
    .eq("id", id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new WebAuthnServiceError("Could not persist the WebAuthn challenge.");
  return Boolean(data);
}

async function recordFailedAttempt(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  transaction: { id: string; failed_attempts: number },
) {
  const { error } = await admin
    .from("authentication_challenges")
    .update({ failed_attempts: transaction.failed_attempts + 1 })
    .eq("id", transaction.id)
    .eq("failed_attempts", transaction.failed_attempts)
    .is("consumed_at", null);
  if (error) throw new WebAuthnServiceError("Could not record a passkey attempt.");
}

export async function createRegistrationOptions(transactionToken: string) {
  const found = await findWebAuthnTransaction(
    transactionToken,
    "WEBAUTHN_REGISTRATION",
  );
  if (!found) return { kind: "expired" as const };
  const { admin, transaction } = found;
  if (transaction.failed_attempts >= MAX_WEBAUTHN_ATTEMPTS) {
    return { kind: "rate_limited" as const };
  }
  const [
    { data: role, error: roleError },
    { data: student, error: studentError },
  ] = await Promise.all([
    admin
      .from("user_roles")
      .select("role")
      .eq("user_id", transaction.user_id)
      .maybeSingle(),
    admin
      .from("students")
      .select("id, registration_number")
      .eq("auth_user_id", transaction.user_id)
      .maybeSingle(),
  ]);
  if (roleError || studentError) {
    throw new WebAuthnServiceError("Could not load the account for passkey registration.");
  }
  if (!role || !["STUDENT", "ADMIN", "SUPER_ADMIN"].includes(role.role)) {
    return { kind: "invalid" as const };
  }
  if (role.role === "STUDENT" && !student) return { kind: "invalid" as const };
  if (role.role !== "STUDENT" && student) {
    throw new WebAuthnServiceError("The account role and student record do not match.");
  }

  const [
    { data: profile, error: profileError },
    { data: existing, error: existingError },
    { data: authUser, error: authUserError },
  ] =
    await Promise.all([
      student
        ? admin
            .from("student_profiles")
            .select("full_name")
            .eq("student_id", student.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from("webauthn_credentials")
        .select("credential_id, transports")
        .eq("user_id", transaction.user_id),
      role.role === "STUDENT"
        ? Promise.resolve({ data: null, error: null })
        : admin.auth.admin.getUserById(transaction.user_id),
    ]);

  if (profileError || existingError || authUserError) {
    throw new WebAuthnServiceError("Could not load the account for passkey registration.");
  }
  const userName = student?.registration_number ?? authUser?.user.email;
  if (!userName) return { kind: "invalid" as const };

  const { rpID } = getRelyingPartyConfig();
  const options = await generateRegistrationOptions({
    rpName: "St Jude University",
    rpID,
    userID: new TextEncoder().encode(transaction.user_id),
    userName,
    userDisplayName: profile?.full_name ?? userName,
    attestationType: "none",
    timeout: 60_000,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      authenticatorAttachment: "platform",
    },
    excludeCredentials: (existing ?? []).map((credential) => ({
      id: credential.credential_id,
      transports: credential.transports,
    })),
  });

  if (!(await saveChallenge(admin, transaction.id, options.challenge))) {
    return { kind: "challenge_exists" as const };
  }
  return { kind: "options" as const, options };
}

async function consumeAndCreateCompletion(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  transaction: {
    id: string;
  },
) {
  const completionToken = randomBytes(32).toString("base64url");
  const { data: completed, error } = await admin.rpc(
    "complete_webauthn_authentication",
    {
      _challenge_id: transaction.id,
      _completion_token_hash: hashTransactionToken(completionToken),
    },
  );
  if (error) {
    throw new WebAuthnServiceError(
      `Could not complete the WebAuthn transaction (database error ${error.code ?? "unknown"}).`,
    );
  }
  if (completed !== true) return false;
  return completionToken;
}

export async function verifyRegistration(
  transactionToken: string,
  responseValue: unknown,
  deviceName: string | undefined,
) {
  const found = await findWebAuthnTransaction(
    transactionToken,
    "WEBAUTHN_REGISTRATION",
  );
  if (!found) return { kind: "expired" as const };
  const { admin, transaction } = found;
  if (!hasAttemptsRemaining(transaction.failed_attempts, MAX_WEBAUTHN_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }
  if (!transaction.webauthn_challenge) return { kind: "options_required" as const };
  if (!isRegistrationResponse(responseValue)) {
    await recordFailedAttempt(admin, transaction);
    return { kind: "invalid_response" as const };
  }

  const { rpID, origin } = getRelyingPartyConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: responseValue,
      expectedChallenge: transaction.webauthn_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.warn("WebAuthn registration response rejected:", error.name);
    await recordFailedAttempt(admin, transaction);
    return { kind: "verification_failed" as const };
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    await recordFailedAttempt(admin, transaction);
    return { kind: "verification_failed" as const };
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;
  const { error: saveError } = await admin.from("webauthn_credentials").insert({
    user_id: transaction.user_id,
    credential_id: credential.id,
    public_key: `\\x${Buffer.from(credential.publicKey).toString("hex")}`,
    signature_counter: credential.counter,
    transports: responseValue.response.transports ?? [],
    device_name: deviceName ?? null,
    backed_up: credentialBackedUp,
  });
  if (saveError) {
    if (saveError.code === "23505") return { kind: "credential_exists" as const };
    throw new WebAuthnServiceError("Could not store the registered passkey.");
  }

  const completionToken = await consumeAndCreateCompletion(admin, transaction);
  if (!completionToken) return { kind: "expired" as const };
  return {
    kind: "verified" as const,
    completionToken,
    credentialDeviceType,
  };
}

export async function createAuthenticationOptions(transactionToken: string) {
  const found = await findWebAuthnTransaction(
    transactionToken,
    "WEBAUTHN_AUTHENTICATION",
  );
  if (!found) return { kind: "expired" as const };
  const { admin, transaction } = found;
  if (!hasAttemptsRemaining(transaction.failed_attempts, MAX_WEBAUTHN_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }
  const { data: credentials, error } = await admin
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", transaction.user_id);
  if (error) throw new WebAuthnServiceError("Could not load registered passkeys.");
  if (!credentials?.length) return { kind: "credential_required" as const };

  const { rpID } = getRelyingPartyConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({
      id: credential.credential_id,
      transports: credential.transports,
    })),
  });
  if (!(await saveChallenge(admin, transaction.id, options.challenge))) {
    return { kind: "challenge_exists" as const };
  }
  return { kind: "options" as const, options };
}

export async function verifyAuthentication(
  transactionToken: string,
  responseValue: unknown,
) {
  const found = await findWebAuthnTransaction(
    transactionToken,
    "WEBAUTHN_AUTHENTICATION",
  );
  if (!found) return { kind: "expired" as const };
  const { admin, transaction } = found;
  if (transaction.failed_attempts >= MAX_WEBAUTHN_ATTEMPTS) {
    return { kind: "rate_limited" as const };
  }
  if (!transaction.webauthn_challenge) return { kind: "options_required" as const };
  if (!isAuthenticationResponse(responseValue)) {
    await recordFailedAttempt(admin, transaction);
    return { kind: "invalid_response" as const };
  }

  const { data: storedCredential, error } = await admin
    .from("webauthn_credentials")
    .select("id, credential_id, public_key, signature_counter, transports")
    .eq("user_id", transaction.user_id)
    .eq("credential_id", responseValue.id)
    .maybeSingle();
  if (error) throw new WebAuthnServiceError("Could not load the registered passkey.");
  if (!storedCredential) return { kind: "credential_not_found" as const };
  if (
    typeof storedCredential.public_key !== "string" ||
    !storedCredential.public_key.startsWith("\\x")
  ) {
    throw new WebAuthnServiceError("Stored passkey public key has an invalid format.");
  }

  const credential: WebAuthnCredential = {
    id: storedCredential.credential_id,
    publicKey: new Uint8Array(
      Buffer.from(storedCredential.public_key.slice(2), "hex"),
    ),
    counter: Number(storedCredential.signature_counter),
    transports: storedCredential.transports,
  };
  const { rpID, origin } = getRelyingPartyConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: responseValue,
      expectedChallenge: transaction.webauthn_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.warn("WebAuthn authentication response rejected:", error.name);
    await recordFailedAttempt(admin, transaction);
    return { kind: "verification_failed" as const };
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    await recordFailedAttempt(admin, transaction);
    return { kind: "verification_failed" as const };
  }

  const { data: updatedCredential, error: counterError } = await admin
    .from("webauthn_credentials")
    .update({
      signature_counter: verification.authenticationInfo.newCounter,
      backed_up: verification.authenticationInfo.credentialBackedUp,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", storedCredential.id)
    .eq("signature_counter", storedCredential.signature_counter)
    .select("id")
    .maybeSingle();
  if (counterError) throw new WebAuthnServiceError("Could not update the passkey counter.");
  if (!updatedCredential) return { kind: "verification_failed" as const };

  const completionToken = await consumeAndCreateCompletion(admin, transaction);
  if (!completionToken) return { kind: "expired" as const };
  return { kind: "verified" as const, completionToken };
}

export function getWebAuthnTransactionCookieName() {
  return getTransactionCookieName();
}

export function isWebAuthnConfigured() {
  return Boolean(process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN);
}
