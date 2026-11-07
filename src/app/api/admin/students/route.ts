import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { adminStudentSearchSchema } from "@/lib/validation/student";
import { z } from "zod";

const inviteStudentSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().toUpperCase().regex(/^STJ\/\d{4}\/\d{5,8}$/),
  admissionYear: z.number().int().min(1900).max(2200),
  yearOfStudy: z.number().int().min(1).max(10),
  programmeId: z.string().uuid().nullable(),
  status: z.enum(["APPLICANT", "ACTIVE"]),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = adminStudentSearchSchema.safeParse(params);
  if (!parsed.success) return jsonError("Invalid student search or pagination parameters.", 400);
  const { search, status, page, pageSize } = parsed.data;

  try {
    const admin = getSupabaseAdminClient();
    let matchingStudentIds: string[] | null = null;
    if (search) {
      const { data: matchingProfiles, error: profileMatchError } = await admin
        .from("student_profiles")
        .select("student_id")
        .ilike("full_name", `%${search}%`);
      if (profileMatchError) return apiUnavailable("Student name search failed.");
      matchingStudentIds = (matchingProfiles ?? []).map((item) => item.student_id);
    }

    let query = admin.from("students")
      .select("id, registration_number, programme_id, admission_year, year_of_study, status, created_at", { count: "exact" })
      .order("registration_number", { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (status) query = query.eq("status", status);
    if (search) {
      const pattern = search.toUpperCase().replaceAll(",", "");
      const match = matchingStudentIds?.length
        ? `,id.in.(${matchingStudentIds.join(",")})`
        : "";
      query = query.or(`registration_number.ilike.%${pattern}%${match}`);
    }
    const { data: students, error, count } = await query;
    if (error) return apiUnavailable("Admin student directory lookup failed.");
    const records = students ?? [];
    const studentIds = records.map((student) => student.id);
    const programmeIds = [...new Set(records.map((student) => student.programme_id).filter((value): value is string => Boolean(value)))];
    const [{ data: profiles, error: profileError }, { data: programmes, error: programmeError }] =
      studentIds.length === 0
        ? [{ data: [], error: null }, { data: [], error: null }]
        : await Promise.all([
            admin.from("student_profiles").select("student_id, full_name").in("student_id", studentIds),
            programmeIds.length ? admin.from("programmes").select("id, code, name").in("id", programmeIds) : Promise.resolve({ data: [], error: null }),
          ]);
    if (profileError || programmeError) return apiUnavailable("Admin student detail lookup failed.");
    const profileByStudent = new Map((profiles ?? []).map((profile) => [profile.student_id, profile]));
    const programmeById = new Map((programmes ?? []).map((programme) => [programme.id, programme]));
    return NextResponse.json({
      students: records.map((student) => ({
        id: student.id,
        registrationNumber: student.registration_number,
        admissionYear: student.admission_year,
        yearOfStudy: student.year_of_study,
        status: student.status,
        profile: profileByStudent.get(student.id) ?? null,
        programme: student.programme_id ? programmeById.get(student.programme_id) ?? null : null,
      })),
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / pageSize) },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Admin student directory lookup failed.");
    throw error;
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;
  const parsed = inviteStudentSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide valid student and invitation details.", 400);

  let createdUserId: string | null = null;
  let createdStudentId: string | null = null;
  try {
    const admin = getSupabaseAdminClient();
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email.toLowerCase(),
      { data: { full_name: parsed.data.fullName } },
    );
    if (inviteError || !invited.user) {
      if (inviteError?.status === 422) return jsonError("An account already exists for that email.", 409);
      console.error("Student invitation failed:", inviteError?.message ?? "No invited user returned.");
      return apiUnavailable("Could not send the student invitation.");
    }
    createdUserId = invited.user.id;

    const { error: roleError } = await admin.from("user_roles").insert({
      user_id: createdUserId,
      role: "STUDENT",
      assigned_by: access.session.id,
    });
    if (roleError) throw new Error(`Could not assign student role (${roleError.code}).`);

    const { data: student, error: studentError } = await admin.from("students")
      .insert({
        auth_user_id: createdUserId,
        registration_number: parsed.data.registrationNumber,
        admission_year: parsed.data.admissionYear,
        year_of_study: parsed.data.yearOfStudy,
        programme_id: parsed.data.programmeId,
        status: parsed.data.status,
      })
      .select("id")
      .single();
    if (studentError) {
      if (studentError.code === "23505") throw new Error("STUDENT_CONFLICT");
      throw new Error(`Could not create student record (${studentError.code}).`);
    }
    createdStudentId = student.id;
    const { error: profileError } = await admin.from("student_profiles")
      .insert({ student_id: student.id, full_name: parsed.data.fullName });
    if (profileError) throw new Error(`Could not create student profile (${profileError.code}).`);
    return NextResponse.json({ invited: true, registrationNumber: parsed.data.registrationNumber }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (createdUserId) {
      const admin = getSupabaseAdminClient();
      if (createdStudentId) {
        const { error: studentCleanupError } = await admin.from("students").delete().eq("id", createdStudentId);
        if (studentCleanupError) console.error("Student record rollback failed:", studentCleanupError.message);
      }
      const { error: roleCleanupError } = await admin.from("user_roles").delete().eq("user_id", createdUserId);
      if (roleCleanupError) console.error("Student role rollback failed:", roleCleanupError.message);
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) console.error("Student provisioning rollback failed:", cleanupError.message);
    }
    if (error instanceof Error && error.message === "STUDENT_CONFLICT") return jsonError("That email or registration number is already in use.", 409);
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Student invitation service is not configured.");
    console.error("Student provisioning failed:", error instanceof Error ? error.message : "Unknown failure.");
    return apiUnavailable("Could not create the student account.");
  }
}
