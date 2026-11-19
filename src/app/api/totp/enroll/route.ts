import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError } from "@/lib/auth/http";
import {
  beginTotpEnrollment,
  getTotpTransactionCookieName,
  TotpServiceError,
  hashTransactionToken,
} from "@/lib/security/totp";
import { MongoConfigurationError } from "@/lib/mongodb/config";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { AuthChallengeModel, StudentModel } from "@/lib/models";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const token = request.cookies.get(getTotpTransactionCookieName())?.value;
  if (!token) return jsonError("Password authentication is required.", 401);

  try {
    await connectToDatabase();
    const challenge = await AuthChallengeModel.findOne({
      challengeHash: hashTransactionToken(token),
      factor: "PASSWORD_TRANSACTION",
      consumedAt: null,
    }).lean();

    if (!challenge?.userId || new Date(challenge.expiresAt).getTime() <= Date.now()) {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(getTotpTransactionCookieName());
      return response;
    }

    const student = await StudentModel.findOne({ authUserId: challenge.userId })
      .select("registrationNumber")
      .lean();

    const result = await beginTotpEnrollment(
      token,
      student?.registrationNumber ?? "university-account",
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
    if (error instanceof MongoConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }
    if (error instanceof TotpServiceError) {
      console.error("TOTP enrollment unavailable:", error.message);
      return jsonError("Could not start authenticator enrollment.", 503);
    }
    throw error;
  }
}
