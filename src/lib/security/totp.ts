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
import { connectToDatabase } from "@/lib/mongodb/connection";
import { MongoConfigurationError } from "@/lib/mongodb/config";
import {
  AuthChallengeModel,
  TotpCredentialModel,
  WebAuthnCredentialModel,
} from "@/lib/models";
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

// ── Crypto helpers ──────────────────────────────────────────────────────────

function getEncryptionKey() {
  const encoded = process.env.TOTP_ENCRYPTION_KEY;
  if (!encoded) {
    throw new MongoConfigurationError("Set TOTP_ENCRYPTION_KEY to a base64-encoded 32-byte key.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new MongoConfigurationError("TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

function recoveryHash(code: string) {
  const key = process.env.TOTP_RECOVERY_HASH_KEY;
  if (!key || key.length < 32) {
    throw new MongoConfigurationError(
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
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
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

// ── Transaction helpers ─────────────────────────────────────────────────────

async function findActiveTransaction(token: string) {
  await connectToDatabase();
  const challenge = await AuthChallengeModel.findOne({
    challengeHash: hashTransactionToken(token),
    factor: { $in: ["PASSWORD_TRANSACTION", "TOTP", "WEBAUTHN_REGISTRATION", "WEBAUTHN_AUTHENTICATION"] },
    consumedAt: null,
  }).lean();

  if (
    !challenge?.userId ||
    !Number.isFinite(new Date(challenge.expiresAt).getTime()) ||
    new Date(challenge.expiresAt).getTime() <= Date.now()
  ) {
    return null;
  }
  return challenge;
}

async function issueTransaction(
  userId: string,
  factor: Factor,
  transactionId = randomUUID(),
  expiresAt?: Date,
) {
  const token = randomBytes(32).toString("base64url");
  await AuthChallengeModel.create({
    authTransactionId: transactionId,
    userId,
    factor,
    challengeHash: hashTransactionToken(token),
    expiresAt: expiresAt ?? new Date(Date.now() + AUTH_TRANSACTION_TTL_SECONDS * 1000),
  });
  return token;
}

async function consumeChallenge(id: string, verified = true) {
  const result = await AuthChallengeModel.findOneAndUpdate(
    { _id: id, consumedAt: null },
    { consumedAt: new Date(), ...(verified ? { verifiedAt: new Date() } : {}) },
  );
  return result !== null;
}

// ── TOTP verification helper ────────────────────────────────────────────────

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

// ── Public API ──────────────────────────────────────────────────────────────

export async function beginTotpChallenge(transactionToken: string) {
  const challenge = await findActiveTransaction(transactionToken);
  if (!challenge) return { kind: "expired" as const };
  if (challenge.factor !== "PASSWORD_TRANSACTION") return { kind: "invalid" as const };

  const credential = await TotpCredentialModel.findOne({
    userId: challenge.userId,
  }).lean();
  if (!credential?.isEnabled) return { kind: "enrollment_required" as const };

  const nextToken = await issueTransaction(
    challenge.userId.toString(),
    "TOTP",
    challenge.authTransactionId,
    challenge.expiresAt,
  );
  if (!(await consumeChallenge(challenge._id.toString()))) {
    await AuthChallengeModel.deleteOne({ challengeHash: hashTransactionToken(nextToken) });
    return { kind: "expired" as const };
  }
  return { kind: "challenge" as const, transactionToken: nextToken };
}

export async function beginTotpEnrollment(transactionToken: string, label: string) {
  const challenge = await findActiveTransaction(transactionToken);
  if (!challenge) return { kind: "expired" as const };
  if (challenge.factor !== "PASSWORD_TRANSACTION") return { kind: "invalid" as const };

  const current = await TotpCredentialModel.findOne({ userId: challenge.userId }).lean();
  if (current?.isEnabled) return { kind: "already_enrolled" as const };

  const secret = generateSecret({ length: 20 });
  const uri = generateURI({ issuer: ISSUER, label, secret, digits: 6, period: PERIOD_SECONDS });
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 256 });

  await TotpCredentialModel.findOneAndUpdate(
    { userId: challenge.userId },
    {
      userId: challenge.userId,
      secretCiphertext: encryptSecret(secret),
      encryptionKeyVersion: 1,
      recoveryCodeHashes: [],
      isEnabled: false,
      enabledAt: null,
      enrollmentExpiresAt: challenge.expiresAt,
    },
    { upsert: true },
  );

  return { kind: "ready" as const, qrDataUrl, manualEntryKey: secret };
}

export async function verifyTotpEnrollment(transactionToken: string, token: string) {
  const challenge = await findActiveTransaction(transactionToken);
  if (!challenge) return { kind: "expired" as const };
  if (challenge.factor !== "PASSWORD_TRANSACTION") return { kind: "invalid" as const };
  if (!hasAttemptsRemaining(challenge.failedAttempts, MAX_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }

  const credential = await TotpCredentialModel.findOne({ userId: challenge.userId }).lean();
  if (
    !credential ||
    credential.isEnabled ||
    !credential.enrollmentExpiresAt ||
    new Date(credential.enrollmentExpiresAt).getTime() <= Date.now()
  ) {
    return { kind: "invalid" as const };
  }

  const checked = await checkTotp(token, decryptSecret(credential.secretCiphertext), null);
  if (checked.kind !== "verified") {
    await AuthChallengeModel.findByIdAndUpdate(challenge._id, {
      $inc: { failedAttempts: 1 },
    });
    return checked;
  }

  // Generate recovery codes
  const recoveryCodes = Array.from({ length: 10 }, () =>
    randomBytes(9).toString("base64url").toUpperCase(),
  );

  // Enable TOTP credential
  await TotpCredentialModel.findOneAndUpdate(
    { userId: challenge.userId },
    {
      isEnabled: true,
      enabledAt: new Date(),
      recoveryCodeHashes: recoveryCodes.map(recoveryHash),
      lastVerifiedStep: checked.verifiedStep,
    },
  );

  // Consume this challenge and issue the WebAuthn transaction
  await consumeChallenge(challenge._id.toString());
  const nextToken = await issueTransaction(
    challenge.userId.toString(),
    "WEBAUTHN_REGISTRATION",
    challenge.authTransactionId,
    challenge.expiresAt,
  );

  return { kind: "verified" as const, recoveryCodes, transactionToken: nextToken };
}

export async function verifyTotpChallenge(transactionToken: string, token: string) {
  const challenge = await findActiveTransaction(transactionToken);
  if (!challenge) return { kind: "expired" as const };
  if (challenge.factor !== "TOTP") return { kind: "invalid" as const };
  if (!hasAttemptsRemaining(challenge.failedAttempts, MAX_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }

  const credential = await TotpCredentialModel.findOne({ userId: challenge.userId }).lean();
  if (!credential?.isEnabled) return { kind: "invalid" as const };

  const checked = await checkTotp(
    token,
    decryptSecret(credential.secretCiphertext),
    credential.lastVerifiedStep ?? null,
  );
  if (checked.kind !== "verified") {
    if (checked.kind === "invalid") {
      await AuthChallengeModel.findByIdAndUpdate(challenge._id, {
        $inc: { failedAttempts: 1 },
      });
    }
    return checked;
  }

  // Atomic replay protection — only update if lastVerifiedStep hasn't moved
  const filter =
    credential.lastVerifiedStep === null
      ? { userId: challenge.userId, lastVerifiedStep: null }
      : { userId: challenge.userId, lastVerifiedStep: credential.lastVerifiedStep };

  const updated = await TotpCredentialModel.findOneAndUpdate(filter, {
    lastVerifiedStep: checked.verifiedStep,
  });
  if (!updated) return { kind: "replayed" as const };
  if (!(await consumeChallenge(challenge._id.toString()))) {
    return { kind: "replayed" as const };
  }

  const credentialCount = await WebAuthnCredentialModel.countDocuments({
    userId: challenge.userId,
  });
  const nextFactor = nextWebAuthnFactor(credentialCount);
  const nextToken = await issueTransaction(
    challenge.userId.toString(),
    nextFactor,
    challenge.authTransactionId,
    challenge.expiresAt,
  );
  return { kind: "verified" as const, nextFactor, transactionToken: nextToken };
}

export async function verifyTotpRecoveryCode(
  transactionToken: string,
  recoveryCode: string,
) {
  const challenge = await findActiveTransaction(transactionToken);
  if (!challenge) return { kind: "expired" as const };
  if (challenge.factor !== "TOTP") return { kind: "invalid" as const };
  if (!hasAttemptsRemaining(challenge.failedAttempts, MAX_ATTEMPTS)) {
    return { kind: "rate_limited" as const };
  }

  const codeHash = recoveryHash(recoveryCode);
  const credential = await TotpCredentialModel.findOne({
    userId: challenge.userId,
    recoveryCodeHashes: codeHash,
  });
  if (!credential) {
    await AuthChallengeModel.findByIdAndUpdate(challenge._id, {
      $inc: { failedAttempts: 1 },
    });
    return { kind: "invalid" as const };
  }

  // Consume the recovery code
  await TotpCredentialModel.findByIdAndUpdate(credential._id, {
    $pull: { recoveryCodeHashes: codeHash },
  });
  await consumeChallenge(challenge._id.toString());

  const credentialCount = await WebAuthnCredentialModel.countDocuments({
    userId: challenge.userId,
  });
  const nextFactor = nextWebAuthnFactor(credentialCount);
  const nextToken = await issueTransaction(
    challenge.userId.toString(),
    nextFactor,
    challenge.authTransactionId,
    challenge.expiresAt,
  );
  return { kind: "verified" as const, nextFactor, transactionToken: nextToken };
}

export function getTotpTransactionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-stj-auth-tx" : "stj-auth-tx";
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
