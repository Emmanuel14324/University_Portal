import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { z } from "zod";

const inviteAdminSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(["ADMIN", "SUPER_ADMIN"]),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;
  try {
    const admin = getSupabaseAdminClient();
    const { data: roles, error } = await admin
      .from("user_roles")
      .select("user_id, role, assigned_at")
      .in("role", ["ADMIN", "SUPER_ADMIN"])
      .order("assigned_at", { ascending: false });
    if (error) return apiUnavailable("Administrator directory lookup failed.");

    const users = await Promise.all((roles ?? []).map(async (item) => {
      const { data, error: userError } = await admin.auth.admin.getUserById(item.user_id);
      if (userError) throw new Error(`Could not load administrator account ${item.user_id}.`);
      return {
        id: item.user_id,
        email: data.user.email ?? "Email unavailable",
        fullName: data.user.user_metadata?.full_name ?? data.user.email ?? "Administrator",
        role: item.role,
        invitedAt: item.assigned_at,
      };
    }));
    return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Administrator directory lookup failed.");
    console.error("Administrator directory lookup failed:", error instanceof Error ? error.message : "Unknown failure.");
    return apiUnavailable("Administrator directory lookup failed.");
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["SUPER_ADMIN"]);
  if (access.response) return access.response;
  const parsed = inviteAdminSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid email address, name, and administrator role.", 400);

  let userId: string | null = null;
  try {
    const admin = getSupabaseAdminClient();
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email.toLowerCase(),
      { data: { full_name: parsed.data.fullName } },
    );
    if (inviteError || !invited.user) {
      if (inviteError?.status === 422) return jsonError("An account already exists for that email.", 409);
      console.error("Administrator invitation failed:", inviteError?.message ?? "No invited user returned.");
      return apiUnavailable("Could not send the administrator invitation.");
    }
    userId = invited.user.id;
    const { error: roleError } = await admin.from("user_roles").insert({
      user_id: userId,
      role: parsed.data.role,
      assigned_by: access.session.id,
    });
    if (roleError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
      if (cleanupError) console.error("Administrator invitation rollback failed:", cleanupError.message);
      if (roleError.code === "23505") return jsonError("That account already has an assigned role.", 409);
      console.error("Could not assign invited administrator role:", roleError.code);
      return apiUnavailable("Could not assign administrator access.");
    }
    return NextResponse.json({ invited: true, email: parsed.data.email.toLowerCase() }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (userId) {
      const { error: cleanupError } = await getSupabaseAdminClient().auth.admin.deleteUser(userId);
      if (cleanupError) console.error("Administrator invitation rollback failed:", cleanupError.message);
    }
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Administrator invitation service is not configured.");
    throw error;
  }
}
