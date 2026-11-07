import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { z } from "zod";

const recordResultSchema = z.object({
  courseRegistrationId: z.string().uuid(),
  marks: z.number().min(0).max(100),
  grade: z.string().regex(/^[A-F][+]?-?$/),
  gradePoints: z.number().min(0).max(5),
  publish: z.boolean().default(false),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    const admin = getSupabaseAdminClient();
    const [
      { data: results, error: resultError },
      { count: activeStudents, error: studentCountError },
      { data: activeRegistrations, error: activeRegistrationError },
    ] = await Promise.all([
      admin.from("examination_results")
        .select("course_registration_id, marks, grade, grade_points, status, published_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin.from("students").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
      admin.from("course_registrations")
        .select("id, course_id, semester_id, student_id")
        .eq("status", "REGISTERED")
        .order("registered_at", { ascending: false })
        .limit(500),
    ]);
    if (resultError || studentCountError || activeRegistrationError) return apiUnavailable("Admin results lookup failed.");

    const resultRows = results ?? [];
    const allRegistrations = activeRegistrations ?? [];
    const registrationIds = [...new Set([
      ...resultRows.map((item) => item.course_registration_id),
      ...allRegistrations.map((item) => item.id),
    ])];
    const [{ data: registrations, error: registrationError }] = registrationIds.length
      ? await Promise.all([
          admin.from("course_registrations")
            .select("id, course_id, semester_id, student_id")
            .in("id", registrationIds),
        ])
      : [{ data: [], error: null }];
    if (registrationError) return apiUnavailable("Admin results registration lookup failed.");
    const registrationRows = registrations ?? [];
    const courseIds = [...new Set(registrationRows.map((row) => row.course_id))];
    const semesterIds = [...new Set(registrationRows.map((row) => row.semester_id))];
    const studentIds = [...new Set(registrationRows.map((row) => row.student_id))];
    const [
      { data: courses, error: courseError },
      { data: semesters, error: semesterError },
      { data: students, error: studentsError },
      { data: profiles, error: profileError },
    ] = await Promise.all([
      courseIds.length ? admin.from("courses").select("id, code, name, credit_units").in("id", courseIds) : Promise.resolve({ data: [], error: null }),
      semesterIds.length ? admin.from("semesters").select("id, academic_year, name").in("id", semesterIds) : Promise.resolve({ data: [], error: null }),
      studentIds.length ? admin.from("students").select("id, registration_number").in("id", studentIds) : Promise.resolve({ data: [], error: null }),
      studentIds.length ? admin.from("student_profiles").select("student_id, full_name").in("student_id", studentIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (courseError || semesterError || studentsError || profileError) return apiUnavailable("Admin results details lookup failed.");

    const registrationById = new Map(registrationRows.map((item) => [item.id, item]));
    const courseById = new Map((courses ?? []).map((item) => [item.id, item]));
    const semesterById = new Map((semesters ?? []).map((item) => [item.id, item]));
    const studentById = new Map((students ?? []).map((item) => [item.id, item]));
    const profileByStudent = new Map((profiles ?? []).map((item) => [item.student_id, item]));
    const listedResults = resultRows.flatMap((result) => {
      const registration = registrationById.get(result.course_registration_id);
      if (!registration) return [];
      return [{
        ...result,
        course: courseById.get(registration.course_id) ?? null,
        semester: semesterById.get(registration.semester_id) ?? null,
        student: {
          registrationNumber: studentById.get(registration.student_id)?.registration_number ?? "—",
          fullName: profileByStudent.get(registration.student_id)?.full_name ?? "Name unavailable",
        },
      }];
    });
    const registrationChoices = allRegistrations.map((registration) => ({
      id: registration.id,
      studentName: profileByStudent.get(registration.student_id)?.full_name ?? "Name unavailable",
      registrationNumber: studentById.get(registration.student_id)?.registration_number ?? "—",
      course: courseById.get(registration.course_id)?.code ?? "Course unavailable",
      semester: semesterById.get(registration.semester_id)
        ? `${semesterById.get(registration.semester_id)?.academic_year} · ${semesterById.get(registration.semester_id)?.name}`
        : "Semester unavailable",
    }));
    return NextResponse.json({
      results: listedResults,
      registrations: registrationChoices,
      activeStudents: activeStudents ?? 0,
      pendingCount: listedResults.filter((item) => item.status === "DRAFT").length,
      publishedCount: listedResults.filter((item) => item.status === "PUBLISHED").length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Admin results lookup failed.");
    throw error;
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;
  const parsed = recordResultSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid course registration, mark, grade, and grade point value.", 400);

  try {
    const admin = getSupabaseAdminClient();
    const { data: registration, error: registrationError } = await admin.from("course_registrations")
      .select("id")
      .eq("id", parsed.data.courseRegistrationId)
      .eq("status", "REGISTERED")
      .maybeSingle();
    if (registrationError) return apiUnavailable("Could not verify the course registration.");
    if (!registration) return jsonError("The course registration is not active.", 404);
    const { data: result, error } = await admin.from("examination_results")
      .upsert({
        course_registration_id: parsed.data.courseRegistrationId,
        marks: parsed.data.marks,
        grade: parsed.data.grade,
        grade_points: parsed.data.gradePoints,
        status: parsed.data.publish ? "PUBLISHED" : "DRAFT",
        published_at: parsed.data.publish ? new Date().toISOString() : null,
        recorded_by: access.session.id,
      }, { onConflict: "course_registration_id" })
      .select("course_registration_id, marks, grade, grade_points, status, published_at")
      .single();
    if (error || !result) return apiUnavailable("Could not save the examination result.");
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Results service is not configured.");
    throw error;
  }
}
