import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable, getActiveStudentIdentity, StudentApiError } from "@/lib/api/students";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { jsonError } from "@/lib/auth/http";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  try {
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);
    const { data: courses, error } = await getSupabaseAdminClient()
      .from("course_registrations")
      .select("id, status, registered_at, course:courses(code, name, department, credit_units), semester:semesters(academic_year, name, starts_on, ends_on)")
      .eq("student_id", student.id)
      .order("registered_at", { ascending: false });
    if (error) return apiUnavailable("Student course lookup failed.");

    return NextResponse.json(
      { courses: courses ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error instanceof StudentApiError) {
      return apiUnavailable("Student course lookup failed.");
    }
    throw error;
  }
}
