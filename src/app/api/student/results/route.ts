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
    const { data: registrations, error: registrationError } = await admin
      .from("course_registrations")
      .select("id, course_id, semester_id")
      .eq("student_id", student.id);
    if (registrationError) return apiUnavailable("Student result lookup failed.");
    const registrationIds = (registrations ?? []).map((item) => item.id);
    if (registrationIds.length === 0) {
      return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data: results, error: resultError } = await admin
      .from("examination_results")
      .select("course_registration_id, marks, grade, grade_points, published_at")
      .eq("status", "PUBLISHED")
      .in("course_registration_id", registrationIds)
      .order("published_at", { ascending: false });
    if (resultError) return apiUnavailable("Student result lookup failed.");
    const published = results ?? [];
    if (published.length === 0) {
      return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const records = registrations ?? [];
    const courseIds = [...new Set(records.map((item) => item.course_id))];
    const semesterIds = [...new Set(records.map((item) => item.semester_id))];
    const [{ data: courses, error: courseError }, { data: semesters, error: semesterError }] =
      await Promise.all([
        admin.from("courses").select("id, code, name, credit_units").in("id", courseIds),
        admin.from("semesters").select("id, academic_year, name").in("id", semesterIds),
      ]);
    if (courseError || semesterError) return apiUnavailable("Student result details lookup failed.");

    const registrationById = new Map(records.map((record) => [record.id, record]));
    const courseById = new Map((courses ?? []).map((course) => [course.id, course]));
    const semesterById = new Map((semesters ?? []).map((semester) => [semester.id, semester]));
    return NextResponse.json(
      {
        results: published.map((result) => {
          const registration = registrationById.get(result.course_registration_id);
          return {
            ...result,
            course: registration ? courseById.get(registration.course_id) ?? null : null,
            semester: registration ? semesterById.get(registration.semester_id) ?? null : null,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error instanceof StudentApiError) {
      return apiUnavailable("Student result lookup failed.");
    }
    throw error;
  }
}
