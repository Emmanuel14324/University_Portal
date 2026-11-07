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
    const admin = getSupabaseAdminClient();
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);

    const [
      { data: profile, error: profileError },
      { data: programme, error: programmeError },
      { data: authUser, error: authUserError },
    ] = await Promise.all([
      admin
        .from("student_profiles")
        .select("full_name, phone_number, date_of_birth, address, emergency_contact_name, emergency_contact_phone")
        .eq("student_id", student.id)
        .maybeSingle(),
      student.programme_id
        ? admin
            .from("programmes")
            .select("code, name, award, department, duration_years")
            .eq("id", student.programme_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin.auth.admin.getUserById(access.session.id),
    ]);

    if (profileError || programmeError || authUserError) {
      return apiUnavailable("Student profile lookup failed.");
    }

    return NextResponse.json(
      {
        student: {
          registrationNumber: student.registration_number,
          admissionYear: student.admission_year,
          yearOfStudy: student.year_of_study,
          status: student.status,
          email: authUser.user.email ?? null,
          profile,
          programme,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error instanceof StudentApiError) {
      return apiUnavailable("Student identity lookup failed.");
    }
    throw error;
  }
}
