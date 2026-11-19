import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable, getActiveStudentIdentity, StudentApiError } from "@/lib/api/students";
import { jsonError } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { FeeStatementModel, PaymentModel, SemesterModel } from "@/lib/models";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  try {
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);

    await connectToDatabase();
    const statements = await FeeStatementModel.find({
      studentId: new mongoose.Types.ObjectId(student.id),
    })
      .sort({ createdAt: -1 })
      .select("_id statementNumber currency billedAmount dueAt status semesterId")
      .lean();

    if (!statements.length) {
      return NextResponse.json({ statements: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const statementIds = statements.map((s) => s._id);
    const semesterIds = [...new Set(statements.map((s) => s.semesterId.toString()))];

    const [payments, semesters] = await Promise.all([
      PaymentModel.find({ feeStatementId: { $in: statementIds } })
        .sort({ createdAt: -1 })
        .select("feeStatementId reference amount method status paidAt createdAt")
        .lean(),
      SemesterModel.find({ _id: { $in: semesterIds } })
        .select("_id academicYear name")
        .lean(),
    ]);

    const semesterById = new Map(semesters.map((s) => [s._id.toString(), s]));
    const paymentsByStatement = new Map<string, typeof payments>();
    for (const p of payments) {
      const key = p.feeStatementId.toString();
      paymentsByStatement.set(key, [...(paymentsByStatement.get(key) ?? []), p]);
    }

    return NextResponse.json(
      {
        statements: statements.map((s) => ({
          id: s._id.toString(),
          statementNumber: s.statementNumber,
          currency: s.currency,
          billedAmount: s.billedAmount,
          dueAt: s.dueAt,
          status: s.status,
          semester: semesterById.get(s.semesterId.toString()) ?? null,
          payments: paymentsByStatement.get(s._id.toString()) ?? [],
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StudentApiError) return apiUnavailable("Student fee lookup failed.");
    throw error;
  }
}
