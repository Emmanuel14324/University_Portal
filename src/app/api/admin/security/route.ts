import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { jsonError } from "@/lib/auth/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
  if (
    !Number.isInteger(page) || page < 1 || page > 100_000 ||
    !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50
  ) {
    return jsonError("Invalid security log pagination parameters.", 400);
  }

  try {
    const admin = getSupabaseAdminClient();
    const [
      { data: events, error: eventsError, count: eventCount },
      { data: sessions, error: sessionsError, count: sessionCount },
    ] = await Promise.all([
      admin
        .from("security_audit_logs")
        .select("id, actor_user_id, subject_user_id, action, entity_type, entity_id, details, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1),
      admin
        .from("user_sessions")
        .select("id, user_id, created_at, revoked_at, expires_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1),
    ]);
    if (eventsError || sessionsError) return apiUnavailable("Admin security log lookup failed.");

    const sessionUserIds = [...new Set((sessions ?? []).map((session) => session.user_id))];
    const { data: students, error: studentsError } = sessionUserIds.length
      ? await admin.from("students").select("id, auth_user_id").in("auth_user_id", sessionUserIds)
      : { data: [], error: null };
    if (studentsError) return apiUnavailable("Admin security account lookup failed.");

    const studentIds = (students ?? []).map((student) => student.id);
    const { data: profiles, error: profilesError } = studentIds.length
      ? await admin.from("student_profiles").select("student_id, full_name").in("student_id", studentIds)
      : { data: [], error: null };
    if (profilesError) return apiUnavailable("Admin security account lookup failed.");

    const profileByUserId = new Map(
      (students ?? []).map((student) => [
        student.auth_user_id,
        (profiles ?? []).find((profile) => profile.student_id === student.id)?.full_name,
      ]),
    );
    const userIds = [...new Set((sessions ?? []).map((session) => session.user_id))];
    const namesByUserId = new Map<string, string>();
    await Promise.all(userIds.map(async (userId) => {
      const { data, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError) throw new Error(`Could not load security-log account ${userId}.`);
      namesByUserId.set(
        userId,
        profileByUserId.get(userId) ?? data.user.user_metadata?.full_name ?? data.user.email ?? "Name unavailable",
      );
    }));

    return NextResponse.json(
      {
        events: events ?? [],
        sessions: (sessions ?? []).map((session) => ({
          id: session.id,
          userId: session.user_id,
          userName: namesByUserId.get(session.user_id) ?? "Name unavailable",
          loggedInAt: session.created_at,
          loggedOutAt: session.revoked_at ?? (
            new Date(session.expires_at).getTime() <= Date.now() ? session.expires_at : null
          ),
          status: session.revoked_at
            ? "Signed out"
            : new Date(session.expires_at).getTime() <= Date.now()
              ? "Expired"
              : "Active",
        })),
        pagination: {
          page,
          pageSize,
          total: eventCount ?? 0,
          totalPages: Math.ceil((eventCount ?? 0) / pageSize),
        },
        sessionPagination: {
          page,
          pageSize,
          total: sessionCount ?? 0,
          totalPages: Math.ceil((sessionCount ?? 0) / pageSize),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return apiUnavailable("Admin security log lookup failed.");
    }
    console.error("Admin security log lookup failed:", error instanceof Error ? error.message : "Unknown failure.");
    return apiUnavailable("Admin security log lookup failed.");
  }
}
