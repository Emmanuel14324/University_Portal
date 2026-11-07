import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { studentCourseRegistrationSchema } from "@/lib/validation/student";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  const parsed = studentCourseRegistrationSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid course and semester.", 400);

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("register_student_course", {
      _auth_user_id: access.session.id,
      _course_id: parsed.data.courseId,
      _semester_id: parsed.data.semesterId,
    });
    if (error) return apiUnavailable("Course registration request failed.");
    const result = data?.[0];
    if (result?.outcome === "already_registered") {
      return jsonError("You are already registered for this course in that semester.", 409);
    }
    if (result?.outcome !== "registered" || typeof result.registration_id !== "string") {
      return jsonError("The course is unavailable or you are not eligible to register.", 409);
    }

    return NextResponse.json(
      { registered: true, registrationId: result.registration_id },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return apiUnavailable("Course registration request failed.");
    }
    throw error;
  }
}
