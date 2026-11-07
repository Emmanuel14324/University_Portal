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
    const { data: statements, error: statementError } = await admin
      .from("fee_statements")
      .select("id, statement_number, currency, billed_amount, due_at, status, semester_id")
      .eq("student_id", student.id)
      .order("created_at", { ascending: false });
    if (statementError) return apiUnavailable("Student fee lookup failed.");

    const statementRecords = statements ?? [];
    if (statementRecords.length === 0) {
      return NextResponse.json({ statements: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const statementIds = statementRecords.map((statement) => statement.id);
    const semesterIds = [...new Set(statementRecords.map((statement) => statement.semester_id))];
    const [{ data: payments, error: paymentError }, { data: semesters, error: semesterError }] =
      await Promise.all([
        admin
          .from("payments")
          .select("fee_statement_id, reference, amount, method, status, paid_at, created_at")
          .in("fee_statement_id", statementIds)
          .order("created_at", { ascending: false }),
        admin.from("semesters").select("id, academic_year, name").in("id", semesterIds),
      ]);
    if (paymentError || semesterError) return apiUnavailable("Student fee details lookup failed.");

    const semesterById = new Map((semesters ?? []).map((semester) => [semester.id, semester]));
    const paymentsByStatement = new Map<string, typeof payments>();
    for (const payment of payments ?? []) {
      const current = paymentsByStatement.get(payment.fee_statement_id) ?? [];
      current.push(payment);
      paymentsByStatement.set(payment.fee_statement_id, current);
    }

    return NextResponse.json(
      {
        statements: statementRecords.map((statement) => ({
          ...statement,
          semester: semesterById.get(statement.semester_id) ?? null,
          payments: paymentsByStatement.get(statement.id) ?? [],
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error instanceof StudentApiError) {
      return apiUnavailable("Student fee lookup failed.");
    }
    throw error;
  }
}
