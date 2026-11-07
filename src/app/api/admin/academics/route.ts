import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { z } from "zod";

const createCourseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/),
  name: z.string().trim().min(2).max(120),
  department: z.string().trim().min(2).max(120),
  creditUnits: z.number().min(0.5).max(60),
  programmeId: z.string().uuid(),
  yearOfStudy: z.number().int().min(1).max(10),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    const admin = getSupabaseAdminClient();
    const [
      { data: programmes, error: programmeError },
      { data: courses, error: courseError },
      { data: semesters, error: semesterError },
    ] = await Promise.all([
      admin.from("programmes").select("id, code, name, award, department, duration_years, is_active").order("name"),
      admin.from("courses").select("id, code, name, department, credit_units, is_active").order("code"),
      admin.from("semesters").select("id, academic_year, name, starts_on, ends_on, registration_opens_at, registration_closes_at, status").order("starts_on", { ascending: false }),
    ]);
    if (programmeError || courseError || semesterError) return apiUnavailable("Admin academic reference lookup failed.");
    return NextResponse.json(
      { programmes: programmes ?? [], courses: courses ?? [], semesters: semesters ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Admin academic reference lookup failed.");
    throw error;
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;
  const parsed = createCourseSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide valid course details.", 400);

  try {
    const admin = getSupabaseAdminClient();
    const { data: programme, error: programmeError } = await admin.from("programmes")
      .select("id")
      .eq("id", parsed.data.programmeId)
      .eq("is_active", true)
      .maybeSingle();
    if (programmeError) return apiUnavailable("Could not verify the selected programme.");
    if (!programme) return jsonError("Select an active programme.", 400);

    const { data: course, error: courseError } = await admin.from("courses")
      .insert({
        code: parsed.data.code,
        name: parsed.data.name,
        department: parsed.data.department,
        credit_units: parsed.data.creditUnits,
      })
      .select("id, code, name")
      .single();
    if (courseError?.code === "23505") return jsonError("A course with that code already exists.", 409);
    if (courseError || !course) return apiUnavailable("Could not create the course.");

    const { error: programmeCourseError } = await admin.from("programme_courses").insert({
      programme_id: parsed.data.programmeId,
      course_id: course.id,
      year_of_study: parsed.data.yearOfStudy,
    });
    if (programmeCourseError) {
      const { error: cleanupError } = await admin.from("courses").delete().eq("id", course.id);
      if (cleanupError) console.error("Course creation rollback failed:", cleanupError.message);
      return apiUnavailable("Could not assign the course to the selected programme.");
    }
    return NextResponse.json({ course }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Course creation service is not configured.");
    throw error;
  }
}
