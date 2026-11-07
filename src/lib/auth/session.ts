import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashTransactionToken } from "@/lib/security/totp";
import { isAppSessionActive } from "@/lib/auth/policies";

export const APP_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AppRole = "STUDENT" | "ADMIN" | "SUPER_ADMIN";

export type AppSession = {
  id: string;
  role: AppRole;
  expiresAt: string;
};

function isAppRole(value: unknown): value is AppRole {
  return value === "STUDENT" || value === "ADMIN" || value === "SUPER_ADMIN";
}

export class AppSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppSessionError";
  }
}

export function getAppSessionCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-stj-session"
    : "stj-session";
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

export async function createAppSession(completionToken: string) {
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + APP_SESSION_TTL_SECONDS * 1000).toISOString();
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("create_authenticated_session", {
    _completion_token_hash: hashTransactionToken(completionToken),
    _session_token_hash: hashTransactionToken(sessionToken),
    _expires_at: expiresAt,
  });

  if (error) {
    throw new AppSessionError("Could not create the authenticated application session.");
  }
  const created = data?.[0];
  if (
    !created ||
    typeof created.session_id !== "string" ||
    typeof created.user_id !== "string" ||
    !isAppRole(created.role)
  ) {
    return { kind: "invalid" as const };
  }

  return {
    kind: "created" as const,
    sessionToken,
    userId: created.user_id,
    role: created.role,
    expiresAt,
  };
}

export async function getAppSession(sessionToken: string | undefined) {
  if (!sessionToken || sessionToken.length < 32 || sessionToken.length > 128) {
    return null;
  }

  const admin = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const tokenHash = hashTransactionToken(sessionToken);
  const { data: session, error: sessionError } = await admin
    .from("user_sessions")
    .select("id, user_id, expires_at, last_seen_at")
    .eq("session_token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .maybeSingle();

  if (sessionError) throw new AppSessionError("Could not validate the application session.");
  if (!session || !isAppSessionActive(session.expires_at, null)) return null;

  const { data: roleRecord, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", session.user_id)
    .maybeSingle();
  if (roleError) throw new AppSessionError("Could not load the application role.");
  const role = roleRecord?.role;
  if (!isAppRole(role)) {
    return null;
  }

  if (role === "STUDENT") {
    const { data: student, error: studentError } = await admin
      .from("students")
      .select("status")
      .eq("auth_user_id", session.user_id)
      .maybeSingle();
    if (studentError) throw new AppSessionError("Could not validate student account status.");
    if (student?.status !== "ACTIVE") {
      await revokeAppSession(sessionToken);
      return null;
    }
  }

  if (Date.now() - new Date(session.last_seen_at).getTime() >= 5 * 60 * 1000) {
    const { error: activityError } = await admin
      .from("user_sessions")
      .update({ last_seen_at: now })
      .eq("id", session.id)
      .is("revoked_at", null)
      .gt("expires_at", now);
    if (activityError) throw new AppSessionError("Could not update session activity.");
  }

  return {
    id: session.user_id,
    role,
    expiresAt: session.expires_at,
  } satisfies AppSession;
}

export async function getCurrentAppSession() {
  const cookieStore = await cookies();
  return getAppSession(cookieStore.get(getAppSessionCookieName())?.value);
}

export async function revokeAppSession(sessionToken: string | undefined) {
  if (!sessionToken || sessionToken.length < 32 || sessionToken.length > 128) {
    return false;
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("revoke_authenticated_session", {
    _session_token_hash: hashTransactionToken(sessionToken),
  });
  if (error) throw new AppSessionError("Could not revoke the application session.");
  return data?.[0]?.revoked === true;
}
