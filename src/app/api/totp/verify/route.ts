import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import {
  getTotpCookieSettings,
  getTotpTransactionCookieName,
  TotpServiceError,
  verifyTotpChallenge,
} from "@/lib/security/totp";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { totpTokenSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const cookieName = getTotpTransactionCookieName();
  const transactionToken = request.cookies.get(cookieName)?.value;
  if (!transactionToken) return jsonError("Password authentication is required.", 401);

  const parsed = totpTokenSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Enter the 6-digit authenticator code.", 400);

  try {
    const result = await verifyTotpChallenge(transactionToken, parsed.data.token);
    if (result.kind === "expired") {
      const response = jsonError("The authentication transaction expired.", 401);
      response.cookies.delete(cookieName);
      return response;
    }
    if (result.kind === "invalid") {
      return jsonError("The authenticator code is invalid.", 401);
    }
    if (result.kind === "replayed") {
      return jsonError("That authenticator code has already been used.", 409);
    }
    if (result.kind === "rate_limited") {
      return jsonError("Too many invalid authenticator codes.", 429);
    }

    const response = NextResponse.json(
      {
        nextFactor: result.nextFactor.toLowerCase(),
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
      console.error("TOTP verification unavailable:", error.message);
      return jsonError("Could not verify the authenticator code.", 503);
    }
    throw error;
  }
}
