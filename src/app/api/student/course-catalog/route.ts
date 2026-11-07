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
    const admin = getSupabaseAdminClient();
    const now = new Date().toISOString();
    const { data: semesters, error: semesterError } = await admin
      .from("semesters")
      .select("id, academic_year, name, starts_on, ends_on, registration_opens_at, registration_closes_at")
      .eq("status", "REGISTRATION_OPEN")
      .or(`registration_opens_at.is.null,registration_opens_at.lte.${now}`)
      .or(`registration_closes_at.is.null,registration_closes_at.gte.${now}`)
      .order("starts_on", { ascending: true });
    if (semesterError) return apiUnavailable("Course registration period lookup failed.");

    if (!student.programme_id || !(semesters?.length)) {
      return NextResponse.json({ courses: [], semesters: semesters ?? [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const [{ data: programmeCourses, error: programmeCourseError }, { data: current, error: currentError }] =
      await Promise.all([
        admin.from("programme_courses")
          .select("course_id")
          .eq("programme_id", student.programme_id)
          .eq("year_of_study", student.year_of_study),
        admin.from("course_registrations")
          .select("course_id, semester_id")
          .eq("student_id", student.id)
          .eq("status", "REGISTERED"),
      ]);
    if (programmeCourseError || currentError) return apiUnavailable("Eligible course lookup failed.");
    const courseIds = [...new Set((programmeCourses ?? []).map((row) => row.course_id))];
    if (!courseIds.length) {
      return NextResponse.json({ courses: [], semesters: semesters ?? [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const { data: courses, error: coursesError } = await admin
      .from("courses")
      .select("id, code, name, department, credit_units")
      .in("id", courseIds)
      .eq("is_active", true)
      .order("code");
    if (coursesError) return apiUnavailable("Eligible course lookup failed.");

    const semesterIds = new Set((semesters ?? []).map((item) => item.id));
    const registered = new Set((current ?? []).filter((item) => semesterIds.has(item.semester_id)).map((item) => item.course_id));
    return NextResponse.json({
      courses: (courses ?? []).map((course) => ({ ...course, registered: registered.has(course.id) })),
      semesters: semesters ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error instanceof StudentApiError) {
      return apiUnavailable("Course catalog lookup failed.");
    }
    throw error;
  }
}
