import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError } from "@/lib/auth/http";
import {
  beginTotpChallenge,
  getTotpCookieSettings,
  getTotpTransactionCookieName,
  TotpServiceError,
} from "@/lib/security/totp";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getTotpTransactionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return jsonError("Password authentication is required.", 401);

  try {
    const result = await beginTotpChallenge(token);
    if (result.kind === "expired") {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(cookieName);
      return response;
    }
    if (result.kind === "invalid") {
      return jsonError("This authentication transaction cannot request TOTP.", 409);
    }
    if (result.kind === "enrollment_required") {
      return NextResponse.json(
        { nextFactor: "totp_enrollment" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = NextResponse.json(
      { nextFactor: "totp", expiresIn: getTotpCookieSettings().maxAge },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(cookieName, result.transactionToken, getTotpCookieSettings());
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }
    if (error instanceof TotpServiceError) {
      console.error("TOTP challenge unavailable:", error.message);
      return jsonError("Could not start TOTP verification.", 503);
    }
    throw error;
  }
}
