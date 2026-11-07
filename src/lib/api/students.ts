import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export class StudentApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentApiError";
  }
}

export async function getActiveStudentIdentity(authUserId: string) {
  const admin = getSupabaseAdminClient();
  const { data: student, error } = await admin
    .from("students")
    .select("id, registration_number, programme_id, admission_year, year_of_study, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) throw new StudentApiError("Could not load the student account.");
  if (!student || student.status !== "ACTIVE") return null;
  return student;
}

export function apiUnavailable(message: string) {
  console.error(message);
  return Response.json(
    { error: { message: "The university data service is temporarily unavailable." } },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
