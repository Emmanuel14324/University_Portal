import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  UserSessionModel,
  UserRoleModel,
  StudentModel,
  AuthChallengeModel,
} from "@/lib/models";
import { isAppSessionActive } from "@/lib/auth/policies";
import type { AppRole } from "@/lib/models/UserRole";

export type { AppRole };

export const APP_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AppSession = {
  id: string;
  role: AppRole;
  expiresAt: string;
};

export class AppSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppSessionError";
  }
}

export function getAppSessionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-stj-session" : "stj-session";
}

export function getAppSessionCookieSettings() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: APP_SESSION_TTL_SECONDS,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isAppRole(value: unknown): value is AppRole {
  return value === "STUDENT" || value === "ADMIN" || value === "SUPER_ADMIN";
}

/**
 * Called after all 3 auth factors pass. Verifies the COMPLETION challenge
 * exists (written by the WebAuthn step), then issues a session.
 */
export async function createAppSession(completionToken: string) {
  await connectToDatabase();

  const tokenHash = hashToken(completionToken);

  // Find the COMPLETION challenge written by the WebAuthn step
  const challenge = await AuthChallengeModel.findOne({
    challengeHash: tokenHash,
    factor: "COMPLETION",
    consumedAt: null,
  }).lean();

  if (
    !challenge ||
    !challenge.userId ||
    new Date(challenge.expiresAt).getTime() <= Date.now()
  ) {
    return { kind: "invalid" as const };
  }

  // Check all 3 factors exist in the same transaction and are verified
  const factors = await AuthChallengeModel.find({
    authTransactionId: challenge.authTransactionId,
    consumedAt: { $ne: null },
    verifiedAt: { $ne: null },
  })
    .select("factor verifiedAt consumedAt")
    .lean();

  const hasPassword = factors.some((f) => f.factor === "PASSWORD_TRANSACTION");
  const hasTotp = factors.some((f) => f.factor === "TOTP");
  const hasWebAuthn = factors.some(
    (f) =>
      f.factor === "WEBAUTHN_REGISTRATION" || f.factor === "WEBAUTHN_AUTHENTICATION",
  );

  if (!hasPassword || !hasTotp || !hasWebAuthn) {
    return { kind: "invalid" as const };
  }

  // Get role
  const roleRecord = await UserRoleModel.findOne({ userId: challenge.userId }).lean();
  if (!roleRecord || !isAppRole(roleRecord.role)) {
    return { kind: "invalid" as const };
  }

  // Consume the COMPLETION challenge
  await AuthChallengeModel.findByIdAndUpdate(challenge._id, { consumedAt: new Date() });

  // Create session
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + APP_SESSION_TTL_SECONDS * 1000);

  await UserSessionModel.create({
    userId: challenge.userId,
    sessionTokenHash: hashToken(sessionToken),
    expiresAt,
    lastSeenAt: new Date(),
  });

  return {
    kind: "created" as const,
    sessionToken,
    userId: challenge.userId.toString(),
    role: roleRecord.role,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getAppSession(sessionToken: string | undefined): Promise<AppSession | null> {
  if (!sessionToken || sessionToken.length < 32 || sessionToken.length > 128) return null;

  await connectToDatabase();
  const now = new Date();
  const tokenHash = hashToken(sessionToken);

  const session = await UserSessionModel.findOne({
    sessionTokenHash: tokenHash,
    revokedAt: null,
    expiresAt: { $gt: now },
  }).lean();

  if (!session || !isAppSessionActive(session.expiresAt.toISOString(), null)) return null;

  const roleRecord = await UserRoleModel.findOne({ userId: session.userId }).lean();
  if (!roleRecord || !isAppRole(roleRecord.role)) return null;

  // Students must be ACTIVE
  if (roleRecord.role === "STUDENT") {
    const student = await StudentModel.findOne({ authUserId: session.userId })
      .select("status")
      .lean();
    if (student?.status !== "ACTIVE") {
      await revokeAppSession(sessionToken);
      return null;
    }
  }

  // Bump last_seen_at if stale > 5 min
  if (Date.now() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
    await UserSessionModel.findByIdAndUpdate(session._id, { lastSeenAt: now });
  }

  return {
    id: session.userId.toString(),
    role: roleRecord.role,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function getCurrentAppSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  return getAppSession(cookieStore.get(getAppSessionCookieName())?.value);
}

export async function revokeAppSession(sessionToken: string | undefined): Promise<boolean> {
  if (!sessionToken || sessionToken.length < 32 || sessionToken.length > 128) return false;

  await connectToDatabase();
  const result = await UserSessionModel.findOneAndUpdate(
    { sessionTokenHash: hashToken(sessionToken), revokedAt: null },
    { revokedAt: new Date() },
  );
  return result !== null;
}
