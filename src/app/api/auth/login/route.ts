import { NextResponse, type NextRequest } from "next/server";
import {
  beginPasswordLogin,
  authTransactionTtlSeconds,
  PasswordLoginUnavailableError,
} from "@/lib/auth/password-login";
import { isSameOriginRequest, jsonError } from "@/lib/auth/http";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { passwordLoginSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsed = passwordLoginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Provide a registration number or email and password.", 400);
  }

  try {
    const result = await beginPasswordLogin(
      parsed.data.identifier,
      parsed.data.password,
    );

    if (result.kind === "invalid_credentials") {
      return jsonError("Invalid registration number/email or password.", 401);
    }

    if (result.kind === "rate_limited") {
      return jsonError("Too many login attempts. Try again later.", 429, {
        "Retry-After": String(result.retryAfter),
      });
    }

    const isProduction = process.env.NODE_ENV === "production";
    const cookieName = isProduction ? "__Host-stj-auth-tx" : "stj-auth-tx";
    const response = NextResponse.json(
      { nextFactor: "totp", expiresIn: authTransactionTtlSeconds },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(cookieName, result.transactionToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: authTransactionTtlSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }

    if (error instanceof PasswordLoginUnavailableError) {
      console.error("Password login unavailable:", error.message);
      return jsonError("Authentication service is temporarily unavailable.", 503);
    }

    throw error;
  }
}
