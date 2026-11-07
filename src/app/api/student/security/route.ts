import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  try {
    const admin = getSupabaseAdminClient();
    const [{ data: totp, error: totpError }, { data: passkeys, error: passkeyError }, { count, error: sessionError }, { data: authUser, error: authUserError }] =
      await Promise.all([
        admin
          .from("totp_credentials")
          .select("is_enabled, enabled_at")
          .eq("user_id", access.session.id)
          .maybeSingle(),
        admin
          .from("webauthn_credentials")
          .select("id, device_name, created_at, last_used_at")
          .eq("user_id", access.session.id)
          .order("created_at", { ascending: false }),
        admin
          .from("user_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", access.session.id)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString()),
        admin.auth.admin.getUserById(access.session.id),
      ]);
    if (totpError || passkeyError || sessionError || authUserError) {
      return apiUnavailable("Student security settings lookup failed.");
    }

    return NextResponse.json(
      {
        authenticator: { enabled: totp?.is_enabled ?? false, enabledAt: totp?.enabled_at ?? null },
        email: authUser.user.email ?? null,
        passkeys: passkeys ?? [],
        activeSessionCount: count ?? 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return apiUnavailable("Student security settings lookup failed.");
    }
    throw error;
  }
}
