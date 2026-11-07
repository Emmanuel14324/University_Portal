import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError } from "@/lib/auth/http";
import {
  beginTotpEnrollment,
  getTotpTransactionCookieName,
  TotpServiceError,
} from "@/lib/security/totp";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const token = request.cookies.get(getTotpTransactionCookieName())?.value;
  if (!token) return jsonError("Password authentication is required.", 401);

  try {
    const admin = getSupabaseAdminClient();
    const { data: challenge, error: challengeError } = await admin
      .from("authentication_challenges")
      .select("user_id, expires_at")
      .eq("challenge_hash", createHash("sha256").update(token).digest("hex"))
      .eq("factor", "PASSWORD_TRANSACTION")
      .is("consumed_at", null)
      .maybeSingle();
    if (challengeError) {
      throw new TotpServiceError("Could not validate the enrollment transaction.");
    }
    if (!challenge?.user_id || new Date(challenge.expires_at).getTime() <= Date.now()) {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(getTotpTransactionCookieName());
      return response;
    }

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("registration_number")
      .eq("auth_user_id", challenge.user_id)
      .maybeSingle();
    if (studentError) throw new TotpServiceError("Could not load student enrollment identity.");

    const result = await beginTotpEnrollment(
      token,
      student?.registration_number ?? "university-account",
    );
    if (result.kind === "expired") {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(getTotpTransactionCookieName());
      return response;
    }
    if (result.kind === "invalid") {
      return jsonError("Complete the password factor before enrolling TOTP.", 409);
    }
    if (result.kind === "already_enrolled") {
      return jsonError("An authenticator is already enrolled.", 409);
    }

    return NextResponse.json(
      { qrCodeDataUrl: result.qrDataUrl, manualEntryKey: result.manualEntryKey },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }
    if (error instanceof TotpServiceError) {
      console.error("TOTP enrollment unavailable:", error.message);
      return jsonError("Could not start authenticator enrollment.", 503);
    }
    throw error;
  }
}
