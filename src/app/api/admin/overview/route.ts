import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    const admin = getSupabaseAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [
      { count: studentCount, error: studentsError },
      { count: courseCount, error: coursesError },
      { count: pendingResults, error: resultsError },
      { count: activeSessions, error: sessionsError },
      { count: recentEvents, error: eventsCountError },
      { data: events, error: eventsError },
      { data: authUser, error: userError },
    ] = await Promise.all([
      admin.from("students").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
      admin.from("courses").select("id", { count: "exact", head: true }).eq("is_active", true),
      admin.from("examination_results").select("id", { count: "exact", head: true }).eq("status", "DRAFT"),
      admin.from("user_sessions").select("id", { count: "exact", head: true }).is("revoked_at", null).gt("expires_at", new Date().toISOString()),
      admin.from("security_audit_logs").select("id", { count: "exact", head: true }).gte("created_at", since),
      admin.from("security_audit_logs").select("id, actor_user_id, action, entity_type, details, created_at").order("created_at", { ascending: false }).limit(10),
      admin.auth.admin.getUserById(access.session.id),
    ]);

    if (studentsError || coursesError || resultsError || sessionsError || eventsCountError || eventsError || userError) {
      return apiUnavailable("Admin dashboard lookup failed.");
    }

    return NextResponse.json({
      user: {
        email: authUser.user.email ?? null,
        name: authUser.user.user_metadata?.full_name ?? authUser.user.email ?? "Administrator",
        role: access.session.role,
      },
      stats: {
        activeStudents: studentCount ?? 0,
        activeCourses: courseCount ?? 0,
        pendingResults: pendingResults ?? 0,
        activeSessions: activeSessions ?? 0,
        eventsLast24Hours: recentEvents ?? 0,
      },
      events: events ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Admin dashboard lookup failed.");
    throw error;
  }
}
