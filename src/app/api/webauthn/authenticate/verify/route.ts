import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import {
  getTotpCookieSettings,
} from "@/lib/security/totp";
import {
  getWebAuthnTransactionCookieName,
  verifyAuthentication,
  WebAuthnServiceError,
} from "@/lib/security/webauthn";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { webauthnAuthenticationSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getWebAuthnTransactionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return jsonError("A TOTP-verified authentication transaction is required.", 401);

  const parsed = webauthnAuthenticationSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid passkey authentication response.", 400);

  try {
    const result = await verifyAuthentication(token, parsed.data.response);
    if (result.kind === "expired") {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(cookieName);
      return response;
    }
    if (result.kind === "rate_limited") {
      return jsonError("Too many passkey attempts. Restart the login flow.", 429);
    }
    if (result.kind === "invalid_response") {
      return jsonError("Invalid passkey authentication response.", 400);
    }
    if (result.kind === "options_required") {
      return jsonError("Request passkey authentication options first.", 409);
    }
    if (result.kind === "credential_not_found") {
      return jsonError("The passkey is not registered to this account.", 401);
    }
    if (result.kind === "verification_failed") {
      return jsonError("Passkey verification failed.", 401);
    }

    const response = NextResponse.json(
      {
        verified: true,
        nextStep: "complete_authentication",
        userVerification: "required",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(cookieName, result.completionToken, getTotpCookieSettings());
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("WebAuthn service is not configured.", 503);
    }
    if (error instanceof WebAuthnServiceError) {
      console.error("WebAuthn authentication verification unavailable:", error.message);
      return jsonError("Could not verify passkey authentication.", 503);
    }
    throw error;
  }
}
