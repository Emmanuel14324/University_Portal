import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable, getActiveStudentIdentity, StudentApiError } from "@/lib/api/students";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { studentProfileUpdateSchema } from "@/lib/validation/student";

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  const parsed = studentProfileUpdateSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide valid editable profile fields.", 400);

  try {
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);

    const { data: updated, error } = await getSupabaseAdminClient()
      .from("student_profiles")
      .update(parsed.data)
      .eq("student_id", student.id)
      .select("student_id")
      .maybeSingle();
    if (error) return apiUnavailable("Student profile update failed.");
    if (!updated) return jsonError("The student profile has not been provisioned.", 404);

    return NextResponse.json(
      { updated: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error instanceof StudentApiError) {
      return apiUnavailable("Student profile update failed.");
    }
    throw error;
  }
}
