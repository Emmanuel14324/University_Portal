import "server-only";
import { randomBytes, createHash } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { MongoConfigurationError } from "@/lib/mongodb/config";
import {
  AuthChallengeModel,
  UserRoleModel,
  StudentModel,
  StudentProfileModel,
  WebAuthnCredentialModel,
  UserModel,
} from "@/lib/models";
import { hasAttemptsRemaining } from "@/lib/auth/policies";

const MAX_WEBAUTHN_ATTEMPTS = 5;

export class WebAuthnServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnServiceError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getRelyingPartyConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID;
  const origin = process.env.WEBAUTHN_ORIGIN;
  if (!rpID || !origin) {
    throw new MongoConfigurationError(
      "Set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN for passkey verification.",
    );
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new MongoConfigurationError("WEBAUTHN_ORIGIN must be a valid absolute URL.");
  }
  if (
    (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") ||
    (process.env.NODE_ENV === "production" && parsedOrigin.protocol !== "https:")
  ) {
    throw new MongoConfigurationError(
      "WebAuthn must use HTTPS in production; HTTP is only permitted for local development.",
    );
  }
  if (parsedOrigin.hostname !== rpID && !parsedOrigin.hostname.endsWith(`.${rpID}`)) {
    throw new MongoConfigurationError(
      "WEBAUTHN_RP_ID must match WEBAUTHN_ORIGIN hostname or a parent domain.",
    );
  }
  return { rpID, origin: parsedOrigin.origin };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) return false;
  const r = value.response;
  return (
    value.type === "public-key" &&
    typeof value.id === "string" &&
    typeof value.rawId === "string" &&
    typeof r.clientDataJSON === "string" &&
    typeof r.attestationObject === "string" &&
    isRecord(value.clientExtensionResults)
  );
}

function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) return false;
  const r = value.response;
  return (
    value.type === "public-key" &&
    typeof value.id === "string" &&
    typeof value.rawId === "string" &&
    typeof r.clientDataJSON === "string" &&
    typeof r.authenticatorData === "string" &&
    typeof r.signature === "string" &&
    isRecord(value.clientExtensionResults)
  );
}

function getTransactionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-stj-auth-tx" : "stj-auth-tx";
}

async function findWebAuthnTransaction(token: string, factor: string) {
  await connectToDatabase();
  const transaction = await AuthChallengeModel.findOne({
    challengeHash: hashToken(token),
    factor,
    consumedAt: null,
  }).lean();

  if (
    !transaction?.userId ||
    !Number.isFinite(new Date(transaction.expiresAt).getTime()) ||
    new Date(transaction.expiresAt).getTime() <= Date.now()
  ) {
    return null;
  }
  return transaction;
}

async function saveChallenge(id: string, challenge: string) {
  const result = await AuthChallengeModel.findOneAndUpdate(
    { _id: id, consumedAt: null },
    { webauthnChallenge: challenge },
  );
  return result !== null;
}

async function recordFailedAttempt(transactionId: string, currentCount: number) {
  await AuthChallengeModel.findByIdAndUpdate(transactionId, {
    $inc: { failedAttempts: 1 },
  });
}

async function consumeAndCreateCompletion(transactionId: string, authTransactionId: string, userId: string, expiresAt: Date) {
  // Consume the WebAuthn challenge
  await AuthChallengeModel.findByIdAndUpdate(transactionId, {
    consumedAt: new Date(),
    verifiedAt: new Date(),
  });

  // Create the COMPLETION challenge for /api/auth/complete to use
  const completionToken = randomBytes(32).toString("base64url");
  await AuthChallengeModel.create({
    authTransactionId,
    userId,
    factor: "COMPLETION",
    challengeHash: hashToken(completionToken),
    expiresAt,
    verifiedAt: new Date(),
  });
  return completionToken;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function createRegistrationOptions(transactionToken: string) {
  const transaction = await findWebAuthnTransaction(transactionToken, "WEBAUTHN_REGISTRATION");
  if (!transaction) return { kind: "expired" as const };
  if (transaction.failedAttempts >= MAX_WEBAUTHN_ATTEMPTS) return { kind: "rate_limited" as const };

  const [roleRecord, student] = await Promise.all([
    UserRoleModel.findOne({ userId: transaction.userId }).lean(),
    StudentModel.findOne({ authUserId: transaction.userId })
      .select("_id registrationNumber")
      .lean(),
  ]);
  if (!roleRecord || !["STUDENT", "ADMIN", "SUPER_ADMIN"].includes(roleRecord.role)) {
    return { kind: "invalid" as const };
  }
  if (roleRecord.role === "STUDENT" && !student) return { kind: "invalid" as const };

  const [profile, existing, user] = await Promise.all([
    student
      ? StudentProfileModel.findOne({ studentId: student._id }).select("fullName").lean()
      : null,
    WebAuthnCredentialModel.find({ userId: transaction.userId })
      .select("credentialId transports")
      .lean(),
    roleRecord.role !== "STUDENT"
      ? UserModel.findById(transaction.userId).select("email").lean()
      : null,
  ]);

  const userName = student?.registrationNumber ?? user?.email;
  if (!userName) return { kind: "invalid" as const };

  const { rpID } = getRelyingPartyConfig();
  const options = await generateRegistrationOptions({
    rpName: "St Jude University",
    rpID,
    userID: new TextEncoder().encode(transaction.userId.toString()),
    userName,
    userDisplayName: profile?.fullName ?? userName,
    attestationType: "none",
    timeout: 60_000,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      authenticatorAttachment: "platform",
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as never,
    })),
  });

  if (!(await saveChallenge(transaction._id.toString(), options.challenge))) {
    return { kind: "challenge_exists" as const };
  }
  return { kind: "options" as const, options };
}

export async function verifyRegistration(
  transactionToken: string,
  responseValue: unknown,
  deviceName: string | undefined,
) {
  const transaction = await findWebAuthnTransaction(transactionToken, "WEBAUTHN_REGISTRATION");
  if (!transaction) return { kind: "expired" as const };
  if (!hasAttemptsRemaining(transaction.failedAttempts, MAX_WEBAUTHN_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }
  if (!transaction.webauthnChallenge) return { kind: "options_required" as const };
  if (!isRegistrationResponse(responseValue)) {
    await recordFailedAttempt(transaction._id.toString(), transaction.failedAttempts);
    return { kind: "invalid_response" as const };
  }

  const { rpID, origin } = getRelyingPartyConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: responseValue,
      expectedChallenge: transaction.webauthnChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.warn("WebAuthn registration response rejected:", error.name);
    await recordFailedAttempt(transaction._id.toString(), transaction.failedAttempts);
    return { kind: "verification_failed" as const };
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    await recordFailedAttempt(transaction._id.toString(), transaction.failedAttempts);
    return { kind: "verification_failed" as const };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const existing = await WebAuthnCredentialModel.findOne({ credentialId: credential.id });
  if (existing) return { kind: "credential_exists" as const };

  await WebAuthnCredentialModel.create({
    userId: transaction.userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    signatureCounter: credential.counter,
    transports: (responseValue as RegistrationResponseJSON).response.transports ?? [],
    deviceName: deviceName ?? null,
    backedUp: credentialBackedUp,
  });

  const completionToken = await consumeAndCreateCompletion(
    transaction._id.toString(),
    transaction.authTransactionId,
    transaction.userId.toString(),
    transaction.expiresAt,
  );
  return { kind: "verified" as const, completionToken, credentialDeviceType };
}

export async function createAuthenticationOptions(transactionToken: string) {
  const transaction = await findWebAuthnTransaction(transactionToken, "WEBAUTHN_AUTHENTICATION");
  if (!transaction) return { kind: "expired" as const };
  if (!hasAttemptsRemaining(transaction.failedAttempts, MAX_WEBAUTHN_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }

  const credentials = await WebAuthnCredentialModel.find({ userId: transaction.userId })
    .select("credentialId transports")
    .lean();
  if (!credentials.length) return { kind: "credential_required" as const };

  const { rpID } = getRelyingPartyConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports as never,
    })),
  });
  if (!(await saveChallenge(transaction._id.toString(), options.challenge))) {
    return { kind: "challenge_exists" as const };
  }
  return { kind: "options" as const, options };
}

export async function verifyAuthentication(transactionToken: string, responseValue: unknown) {
  const transaction = await findWebAuthnTransaction(transactionToken, "WEBAUTHN_AUTHENTICATION");
  if (!transaction) return { kind: "expired" as const };
  if (transaction.failedAttempts >= MAX_WEBAUTHN_ATTEMPTS) return { kind: "rate_limited" as const };
  if (!transaction.webauthnChallenge) return { kind: "options_required" as const };
  if (!isAuthenticationResponse(responseValue)) {
    await recordFailedAttempt(transaction._id.toString(), transaction.failedAttempts);
    return { kind: "invalid_response" as const };
  }

  const storedCredential = await WebAuthnCredentialModel.findOne({
    userId: transaction.userId,
    credentialId: responseValue.id,
  }).lean();
  if (!storedCredential) return { kind: "credential_not_found" as const };

  const credential: WebAuthnCredential = {
    id: storedCredential.credentialId,
    publicKey: new Uint8Array(storedCredential.publicKey),
    counter: storedCredential.signatureCounter,
    transports: storedCredential.transports as never,
  };

  const { rpID, origin } = getRelyingPartyConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: responseValue,
      expectedChallenge: transaction.webauthnChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.warn("WebAuthn authentication response rejected:", error.name);
    await recordFailedAttempt(transaction._id.toString(), transaction.failedAttempts);
    return { kind: "verification_failed" as const };
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    await recordFailedAttempt(transaction._id.toString(), transaction.failedAttempts);
    return { kind: "verification_failed" as const };
  }

  // Atomic counter update — if another request already incremented, bail
  const updated = await WebAuthnCredentialModel.findOneAndUpdate(
    { _id: storedCredential._id, signatureCounter: storedCredential.signatureCounter },
    {
      signatureCounter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date(),
    },
  );
  if (!updated) return { kind: "verification_failed" as const };

  const completionToken = await consumeAndCreateCompletion(
    transaction._id.toString(),
    transaction.authTransactionId,
    transaction.userId.toString(),
    transaction.expiresAt,
  );
  return { kind: "verified" as const, completionToken };
}

export function getWebAuthnTransactionCookieName() {
  return getTransactionCookieName();
}

export function isWebAuthnConfigured() {
  return Boolean(process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN);
}
