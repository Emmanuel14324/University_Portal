import "server-only";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AUTH_TRANSACTION_TTL_SECONDS } from "@/lib/auth/transaction";
import {
  getSupabaseConfig,
  SupabaseConfigurationError,
} from "@/lib/supabase/config";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;
const LOCKOUT_SECONDS = 15 * 60;

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
    throw new SupabaseConfigurationError(
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

async function recordFailedAttempt(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  identifierHash: string,
  userId: string | null,
) {
  const { error: rateLimitError } = await admin.rpc("record_password_failure", {
    _identifier_hash: identifierHash,
    _max_failures: LOCKOUT_THRESHOLD,
    _window_seconds: LOCKOUT_WINDOW_SECONDS,
    _lock_seconds: LOCKOUT_SECONDS,
  });

  if (rateLimitError) {
    throw new PasswordLoginUnavailableError(
      "Could not update password-login rate limits.",
    );
  }

  const { error: attemptError } = await admin.from("login_attempts").insert({
    user_id: userId,
    identifier_hash: identifierHash,
    factor: "PASSWORD_TRANSACTION",
    succeeded: false,
  });

  if (attemptError) {
    throw new PasswordLoginUnavailableError(
      "Could not record the password-login attempt.",
    );
  }
}

export async function beginPasswordLogin(
  rawIdentifier: string,
  password: string,
): Promise<PasswordLoginResult> {
  const identifier = isEmail(rawIdentifier)
    ? rawIdentifier.trim().toLowerCase()
    : rawIdentifier.trim().toUpperCase();
  const isRegistrationNumberLogin = !isEmail(identifier);
  const identifierHash = getIdentifierHash(identifier);
  const admin = getSupabaseAdminClient();

  const { data: limitRecord, error: limitError } = await admin
    .from("auth_rate_limits")
    .select("locked_until")
    .eq("identifier_hash", identifierHash)
    .maybeSingle();

  if (limitError) {
    throw new PasswordLoginUnavailableError(
      "Could not check password-login rate limits.",
    );
  }

  if (limitRecord?.locked_until) {
    const remaining = Math.ceil(
      (new Date(limitRecord.locked_until).getTime() - Date.now()) / 1000,
    );
    if (remaining > 0) {
      return { kind: "rate_limited", retryAfter: remaining };
    }
  }

  let email = isEmail(identifier) ? identifier : null;
  let studentStatus: string | null = null;
  let userId: string | null = null;

  if (!email) {
    const { data: student, error: studentError } = await admin
      .from("students")
      .select("auth_user_id, status")
      .eq("registration_number", identifier)
      .maybeSingle();

    if (studentError) {
      throw new PasswordLoginUnavailableError(
        "Could not look up the university registration number.",
      );
    }

    if (student) {
      userId = student.auth_user_id;
      studentStatus = student.status;
      const { data: authUser, error: authUserError } =
        await admin.auth.admin.getUserById(student.auth_user_id);

      if (authUserError) {
        throw new PasswordLoginUnavailableError(
          "Could not resolve the pre-provisioned student account.",
        );
      }

      email = authUser.user.email ?? null;
    }
  }

  const { url, publishableKey } = getSupabaseConfig();
  const passwordClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const authResult = await passwordClient.auth.signInWithPassword({
    email: email ?? "unknown-account@invalid.example",
    password,
  });

  if (authResult.error) {
    if (!authResult.error.status || authResult.error.status >= 500) {
      throw new PasswordLoginUnavailableError(
        "The Supabase Auth password service is unavailable.",
      );
    }

    await recordFailedAttempt(admin, identifierHash, userId);
    return authResult.error.status === 429
      ? { kind: "rate_limited", retryAfter: LOCKOUT_WINDOW_SECONDS }
      : { kind: "invalid_credentials" };
  }

  const authenticatedUser = authResult.data.user;
  if (!authenticatedUser || !authResult.data.session) {
    throw new PasswordLoginUnavailableError(
      "Supabase Auth returned an incomplete password-login result.",
    );
  }

  userId = authenticatedUser.id;
  const { data: role, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (roleError) {
    throw new PasswordLoginUnavailableError(
      "Could not check the pre-provisioned account role.",
    );
  }

  if (!role) {
    await recordFailedAttempt(admin, identifierHash, userId);
    return { kind: "invalid_credentials" };
  }

  if (isRegistrationNumberLogin && role.role !== "STUDENT") {
    await recordFailedAttempt(admin, identifierHash, userId);
    return { kind: "invalid_credentials" };
  }

  if (role.role === "STUDENT") {
    if (!studentStatus) {
      const { data: student, error: studentError } = await admin
        .from("students")
        .select("id, status")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (studentError) {
        throw new PasswordLoginUnavailableError(
          "Could not check the student account status.",
        );
      }

      studentStatus = student?.status ?? null;
    }

    if (studentStatus !== "ACTIVE") {
      await recordFailedAttempt(admin, identifierHash, userId);
      return { kind: "invalid_credentials" };
    }
  }

  const { error: successfulAttemptError } = await admin
    .from("login_attempts")
    .insert({
      user_id: userId,
      identifier_hash: identifierHash,
      factor: "PASSWORD_TRANSACTION",
      succeeded: true,
    });

  if (successfulAttemptError) {
    throw new PasswordLoginUnavailableError(
      "Could not record the successful password-login attempt.",
    );
  }

  const { error: resetLimitError } = await admin
    .from("auth_rate_limits")
    .delete()
    .eq("identifier_hash", identifierHash);

  if (resetLimitError) {
    throw new PasswordLoginUnavailableError(
      "Could not clear the password-login rate limit.",
    );
  }

  const transactionToken = randomBytes(32).toString("base64url");
  const transactionId = randomUUID();
  const expiresAt = new Date(
    Date.now() + AUTH_TRANSACTION_TTL_SECONDS * 1000,
  ).toISOString();
  const { error: challengeError } = await admin
    .from("authentication_challenges")
    .insert({
      auth_transaction_id: transactionId,
      user_id: userId,
      factor: "PASSWORD_TRANSACTION",
      challenge_hash: hashOpaqueToken(transactionToken),
      expires_at: expiresAt,
      verified_at: new Date().toISOString(),
    });

  if (challengeError) {
    throw new PasswordLoginUnavailableError(
      "Could not create the temporary authentication transaction.",
    );
  }

  return { kind: "authenticated", transactionToken };
}

export const authTransactionTtlSeconds = AUTH_TRANSACTION_TTL_SECONDS;
