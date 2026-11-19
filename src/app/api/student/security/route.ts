import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  TotpCredentialModel,
  WebAuthnCredentialModel,
  UserSessionModel,
  UserModel,
} from "@/lib/models";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  try {
    await connectToDatabase();
    const userId = new mongoose.Types.ObjectId(access.session.id);
    const now = new Date();

    const [totp, passkeys, activeSessionCount, user] = await Promise.all([
      TotpCredentialModel.findOne({ userId }).select("isEnabled enabledAt").lean(),
      WebAuthnCredentialModel.find({ userId })
        .sort({ createdAt: -1 })
        .select("_id deviceName createdAt lastUsedAt")
        .lean(),
      UserSessionModel.countDocuments({ userId, revokedAt: null, expiresAt: { $gt: now } }),
      UserModel.findById(userId).select("email").lean(),
    ]);

    return NextResponse.json(
      {
        authenticator: { enabled: totp?.isEnabled ?? false, enabledAt: totp?.enabledAt ?? null },
        email: user?.email ?? null,
        passkeys: passkeys.map((p) => ({
          id: p._id.toString(),
          deviceName: p.deviceName,
          createdAt: p.createdAt,
          lastUsedAt: p.lastUsedAt,
        })),
        activeSessionCount,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Student security settings lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Student security settings lookup failed.");
  }
}
