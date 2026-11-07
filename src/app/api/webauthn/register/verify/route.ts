import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import {
  getTotpCookieSettings,
} from "@/lib/security/totp";
import {
  getWebAuthnTransactionCookieName,
  verifyRegistration,
  WebAuthnServiceError,
} from "@/lib/security/webauthn";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { webauthnRegistrationSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getWebAuthnTransactionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return jsonError("A TOTP-verified enrollment transaction is required.", 401);

  const parsed = webauthnRegistrationSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid passkey registration response.", 400);

  try {
    const result = await verifyRegistration(
      token,
      parsed.data.response,
      parsed.data.deviceName,
    );
    if (result.kind === "expired") {
      const response = jsonError("The enrollment transaction expired.", 401);
      response.cookies.delete(cookieName);
      return response;
    }
    if (result.kind === "rate_limited") {
      return jsonError("Too many passkey attempts. Restart the login flow.", 429);
    }
    if (result.kind === "invalid_response") {
      return jsonError("Invalid passkey registration response.", 400);
    }
    if (result.kind === "options_required") {
      return jsonError("Request passkey registration options first.", 409);
    }
    if (result.kind === "verification_failed") {
      return jsonError("Passkey verification failed.", 401);
    }
    if (result.kind === "credential_exists") {
      return jsonError("This passkey is already registered.", 409);
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
      console.error("WebAuthn registration verification unavailable:", error.message);
      return jsonError("Could not verify passkey registration.", 503);
    }
    throw error;
  }
}
