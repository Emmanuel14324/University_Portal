import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth/http";
import { AppSessionError, getCurrentAppSession } from "@/lib/auth/session";
import { MongoConfigurationError } from "@/lib/mongodb/config";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { UserModel } from "@/lib/models";

export async function GET() {
  try {
    const session = await getCurrentAppSession();
    if (!session) return jsonError("Authentication is required.", 401);

    await connectToDatabase();
    const user = await UserModel.findById(session.id).select("email fullName").lean();
    if (!user) {
      console.error("Session account lookup failed: user not found");
      return jsonError("Could not load the signed-in account details.", 503);
    }

    return NextResponse.json(
      {
        user: {
          id: session.id,
          role: session.role,
          email: user.email,
          name: user.fullName ?? user.email,
        },
        expiresAt: session.expiresAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MongoConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }
    if (error instanceof AppSessionError) {
      console.error("Session lookup failed:", error.message);
      return jsonError("Could not validate the application session.", 503);
    }
    throw error;
  }
}
