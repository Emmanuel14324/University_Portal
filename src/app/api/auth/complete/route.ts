import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError } from "@/lib/auth/http";
import {
  getWebAuthnTransactionCookieName,
} from "@/lib/security/webauthn";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import {
  APP_SESSION_TTL_SECONDS,
  AppSessionError,
  createAppSession,
  getAppSessionCookieName,
  getAppSessionCookieSettings,
} from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getWebAuthnTransactionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return jsonError("Complete all three factors first.", 401);

  try {
    const result = await createAppSession(token);
    if (result.kind === "invalid") {
      const response = jsonError("The authentication factors are incomplete or the transaction expired.", 401);
      response.cookies.delete(cookieName);
      return response;
    }

    const response = NextResponse.json(
      {
        factorsVerified: true,
        sessionIssued: true,
        redirectTo: result.role === "STUDENT" ? "/student/dashboard" : "/admin/dashboard",
        expiresIn: APP_SESSION_TTL_SECONDS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      getAppSessionCookieName(),
      result.sessionToken,
      getAppSessionCookieSettings(),
    );
    response.cookies.delete(cookieName);
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }
    if (error instanceof AppSessionError) {
      console.error("Authentication completion check failed:", error.message);
      return jsonError("Could not create the authenticated application session.", 503);
    }
    throw error;
  }
}
