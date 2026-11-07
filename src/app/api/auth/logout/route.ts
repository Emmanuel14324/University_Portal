import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError } from "@/lib/auth/http";
import {
  AppSessionError,
  getAppSessionCookieName,
  revokeAppSession,
} from "@/lib/auth/session";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getAppSessionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  try {
    if (token) await revokeAppSession(token);
    const response = NextResponse.json(
      { signedOut: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.delete(cookieName);
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("Authentication service is not configured; the session remains active.", 503);
    }
    if (error instanceof AppSessionError) {
      console.error("Session revocation failed:", error.message);
      return jsonError("Could not complete server-side session revocation; the session remains active.", 503);
    }
    throw error;
  }
}
