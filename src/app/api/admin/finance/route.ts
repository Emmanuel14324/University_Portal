import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    const admin = getSupabaseAdminClient();
    const { data: statements, error: statementsError } = await admin
      .from("fee_statements")
      .select("id, student_id, statement_number, currency, billed_amount, due_at, status, semester_id, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (statementsError) return apiUnavailable("Admin finance lookup failed.");

    const list = statements ?? [];
    const studentIds = [...new Set(list.map((item) => item.student_id))];
    const semesterIds = [...new Set(list.map((item) => item.semester_id))];
    const [{ data: students, error: studentsError }, { data: semesters, error: semestersError }, { data: payments, error: paymentsError }] =
      list.length === 0
        ? [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
        : await Promise.all([
            admin.from("students").select("id, registration_number").in("id", studentIds),
            admin.from("semesters").select("id, academic_year, name").in("id", semesterIds),
            admin.from("payments").select("fee_statement_id, amount, status").in("fee_statement_id", list.map((item) => item.id)),
          ]);
    if (studentsError || semestersError || paymentsError) return apiUnavailable("Admin finance details lookup failed.");

    const [{ data: profiles, error: profilesError }] = studentIds.length === 0
      ? [{ data: [], error: null }]
      : await Promise.all([
          admin.from("student_profiles").select("student_id, full_name").in("student_id", studentIds),
        ]);
    if (profilesError) return apiUnavailable("Admin finance details lookup failed.");

    const studentById = new Map((students ?? []).map((row) => [row.id, row]));
    const profileByStudent = new Map((profiles ?? []).map((row) => [row.student_id, row]));
    const semesterById = new Map((semesters ?? []).map((row) => [row.id, row]));
    const paidByStatement = new Map<string, number>();
    for (const payment of payments ?? []) {
      if (payment.status === "PAID") {
        paidByStatement.set(payment.fee_statement_id, (paidByStatement.get(payment.fee_statement_id) ?? 0) + Number(payment.amount));
      }
    }

    const records = list.map((statement) => {
      const student = studentById.get(statement.student_id);
      return {
        id: statement.id,
        statementNumber: statement.statement_number,
        registrationNumber: student?.registration_number ?? "—",
        studentName: profileByStudent.get(statement.student_id)?.full_name ?? "Name unavailable",
        currency: statement.currency,
        billedAmount: Number(statement.billed_amount),
        paidAmount: paidByStatement.get(statement.id) ?? 0,
        dueAt: statement.due_at,
        status: statement.status,
        semester: semesterById.get(statement.semester_id) ?? null,
      };
    });

    return NextResponse.json({ statements: records }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Admin finance lookup failed.");
    throw error;
  }
}
