import "server-only";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { MongoConfigurationError } from "@/lib/mongodb/config";
import {
  UserModel,
  StudentModel,
  UserRoleModel,
  AuthRateLimitModel,
  LoginAttemptModel,
  AuthChallengeModel,
} from "@/lib/models";
import { AUTH_TRANSACTION_TTL_SECONDS } from "@/lib/auth/transaction";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

export class PasswordLoginUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordLoginUnavailableError";
  }
}

export type PasswordLoginResult =
  | { kind: "authenticated"; transactionToken: string }
  | { kind: "invalid_credentials" }
  | { kind: "rate_limited"; retryAfter: number };

function getIdentifierHash(identifier: string): string {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) {
    throw new MongoConfigurationError(
      "Set AUTH_RATE_LIMIT_SECRET to a random value of at least 32 characters.",
    );
  }
  return createHmac("sha256", secret).update(identifier).digest("hex");
}

function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isEmail(identifier: string): boolean {
  return identifier.includes("@");
}

async function recordFailedAttempt(identifierHash: string, userId: string | null) {
  const now = new Date();

  // Load or create the rate-limit record in application code — avoids
  // aggregation pipeline upsert bugs on first-time documents.
  const existing = await AuthRateLimitModel.findOne({ identifierHash });

  if (!existing) {
    // First failure — create a fresh record
    await AuthRateLimitModel.create({
      identifierHash,
      failureCount: 1,
      windowStartsAt: now,
      lockedUntil: null,
    });
  } else {
    const windowExpired = now.getTime() - existing.windowStartsAt.getTime() >= LOCKOUT_WINDOW_MS;
    const newCount = windowExpired ? 1 : existing.failureCount + 1;
    const lockedUntil = newCount >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_MS) : null;

    await AuthRateLimitModel.findByIdAndUpdate(existing._id, {
      failureCount: newCount,
      windowStartsAt: windowExpired ? now : existing.windowStartsAt,
      lockedUntil,
    });
  }

  await LoginAttemptModel.create({
    userId: userId ?? null,
    identifierHash,
    factor: "PASSWORD_TRANSACTION",
    succeeded: false,
  });
}

export async function beginPasswordLogin(
  rawIdentifier: string,
  password: string,
): Promise<PasswordLoginResult> {
  await connectToDatabase();

  const identifier = isEmail(rawIdentifier)
    ? rawIdentifier.trim().toLowerCase()
    : rawIdentifier.trim().toUpperCase();

  const identifierHash = getIdentifierHash(identifier);

  // Check rate limit
  const limitRecord = await AuthRateLimitModel.findOne({ identifierHash }).lean();
  if (limitRecord?.lockedUntil) {
    const remaining = Math.ceil((limitRecord.lockedUntil.getTime() - Date.now()) / 1000);
    if (remaining > 0) {
      return { kind: "rate_limited", retryAfter: remaining };
    }
  }

  // Resolve user
  let user: { _id: string; email: string; passwordHash: string } | null = null;
  let studentStatus: string | null = null;
  let userId: string | null = null;

  if (isEmail(identifier)) {
    const found = await UserModel.findOne({ email: identifier }).select("_id email passwordHash").lean();
    if (found) {
      user = { _id: found._id.toString(), email: found.email, passwordHash: found.passwordHash };
      userId = user._id;
    }
  } else {
    // Registration number login — must be a student
    const student = await StudentModel.findOne({ registrationNumber: identifier })
      .select("_id authUserId status")
      .lean();
    if (student) {
      userId = student.authUserId.toString();
      studentStatus = student.status;
      const found = await UserModel.findById(student.authUserId)
        .select("_id email passwordHash")
        .lean();
      if (found) {
        user = { _id: found._id.toString(), email: found.email, passwordHash: found.passwordHash };
      }
    }
  }

  // Verify password — always run bcrypt to prevent timing attacks
  const dummyHash = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  const passwordMatch = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);

  if (!user || !passwordMatch) {
    await recordFailedAttempt(identifierHash, userId);
    return { kind: "invalid_credentials" };
  }

  // Check role
  const roleRecord = await UserRoleModel.findOne({ userId: user._id }).lean();
  if (!roleRecord) {
    await recordFailedAttempt(identifierHash, userId);
    return { kind: "invalid_credentials" };
  }

  // Registration number login must map to a STUDENT
  if (!isEmail(identifier) && roleRecord.role !== "STUDENT") {
    await recordFailedAttempt(identifierHash, userId);
    return { kind: "invalid_credentials" };
  }

  // Active student check
  if (roleRecord.role === "STUDENT") {
    if (!studentStatus) {
      const student = await StudentModel.findOne({ authUserId: user._id })
        .select("status")
        .lean();
      studentStatus = student?.status ?? null;
    }
    if (studentStatus !== "ACTIVE") {
      await recordFailedAttempt(identifierHash, userId);
      return { kind: "invalid_credentials" };
    }
  }

  // Record success + clear rate limit
  await Promise.all([
    LoginAttemptModel.create({
      userId: user._id,
      identifierHash,
      factor: "PASSWORD_TRANSACTION",
      succeeded: true,
    }),
    AuthRateLimitModel.deleteOne({ identifierHash }),
  ]);

  // Create auth transaction challenge
  const transactionToken = randomBytes(32).toString("base64url");
  const transactionId = randomUUID();
  const expiresAt = new Date(Date.now() + AUTH_TRANSACTION_TTL_SECONDS * 1000);

  await AuthChallengeModel.create({
    authTransactionId: transactionId,
    userId: user._id,
    factor: "PASSWORD_TRANSACTION",
    challengeHash: hashOpaqueToken(transactionToken),
    expiresAt,
    verifiedAt: new Date(),
  });

  return { kind: "authenticated", transactionToken };
}

export const authTransactionTtlSeconds = AUTH_TRANSACTION_TTL_SECONDS;
