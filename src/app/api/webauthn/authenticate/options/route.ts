import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError } from "@/lib/auth/http";
import {
  createAuthenticationOptions,
  getWebAuthnTransactionCookieName,
  WebAuthnServiceError,
} from "@/lib/security/webauthn";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getWebAuthnTransactionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return jsonError("A TOTP-verified authentication transaction is required.", 401);

  try {
    const result = await createAuthenticationOptions(token);
    if (result.kind === "expired") {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(cookieName);
      return response;
    }
    if (result.kind === "credential_required") {
      return jsonError("No passkey is enrolled for this account.", 409);
    }
    if (result.kind === "rate_limited") {
      return jsonError("Too many passkey attempts. Restart the login flow.", 429);
    }
    return NextResponse.json(result.options, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("WebAuthn service is not configured.", 503);
    }
    if (error instanceof WebAuthnServiceError) {
      console.error("WebAuthn authentication options unavailable:", error.message);
      return jsonError("Could not start passkey authentication.", 503);
    }
    throw error;
  }
}
