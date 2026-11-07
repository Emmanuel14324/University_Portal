import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import {
  getTotpCookieSettings,
  getTotpTransactionCookieName,
  TotpServiceError,
  verifyTotpRecoveryCode,
} from "@/lib/security/totp";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { totpRecoveryCodeSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getTotpTransactionCookieName();
  const transactionToken = request.cookies.get(cookieName)?.value;
  if (!transactionToken) return jsonError("Password authentication is required.", 401);

  const parsed = totpRecoveryCodeSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Enter one of your saved recovery codes.", 400);

  try {
    const result = await verifyTotpRecoveryCode(
      transactionToken,
      parsed.data.recoveryCode,
    );
    if (result.kind === "expired") {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(cookieName);
      return response;
    }
    if (result.kind === "invalid") {
      return jsonError("That recovery code is invalid or has already been used.", 401);
    }
    if (result.kind === "rate_limited") {
      return jsonError("Too many recovery-code attempts. Restart sign-in later.", 429);
    }

    const response = NextResponse.json(
      {
        nextFactor: result.nextFactor.toLowerCase(),
        recoveryCodeUsed: true,
        expiresIn: getTotpCookieSettings().maxAge,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(cookieName, result.transactionToken, getTotpCookieSettings());
    return response;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }
    if (error instanceof TotpServiceError) {
      console.error("TOTP recovery unavailable:", error.message);
      return jsonError("Could not verify the recovery code.", 503);
    }
    throw error;
  }
}
