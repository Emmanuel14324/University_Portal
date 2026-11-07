import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth/http";
import {
  AppSessionError,
  getCurrentAppSession,
} from "@/lib/auth/session";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const session = await getCurrentAppSession();
    if (!session) return jsonError("Authentication is required.", 401);
    const { data: authUser, error: userError } = await getSupabaseAdminClient()
      .auth.admin.getUserById(session.id);
    if (userError) {
      console.error("Session account lookup failed:", userError.message);
      return jsonError("Could not load the signed-in account details.", 503);
    }
    return NextResponse.json(
      {
        user: {
          id: session.id,
          role: session.role,
          email: authUser.user.email ?? null,
          name: authUser.user.user_metadata?.full_name ?? authUser.user.email ?? null,
        },
        expiresAt: session.expiresAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonError("Authentication service is not configured.", 503);
    }
    if (error instanceof AppSessionError) {
      console.error("Session lookup failed:", error.message);
      return jsonError("Could not validate the application session.", 503);
    }
    throw error;
  }
}
