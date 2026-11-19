import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  FeeStatementModel,
  StudentModel,
  StudentProfileModel,
  SemesterModel,
  PaymentModel,
} from "@/lib/models";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    await connectToDatabase();
    const statements = await FeeStatementModel.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .select("_id studentId semesterId statementNumber currency billedAmount dueAt status createdAt")
      .lean();

    if (!statements.length) {
      return NextResponse.json({ statements: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const studentIds = [...new Set(statements.map((s) => s.studentId.toString()))];
    const semesterIds = [...new Set(statements.map((s) => s.semesterId.toString()))];
    const statementIds = statements.map((s) => s._id);

    const [students, semesters, payments, profiles] = await Promise.all([
      StudentModel.find({ _id: { $in: studentIds } }).select("_id registrationNumber").lean(),
      SemesterModel.find({ _id: { $in: semesterIds } }).select("_id academicYear name").lean(),
      PaymentModel.find({ feeStatementId: { $in: statementIds } })
        .select("feeStatementId amount status")
        .lean(),
      StudentProfileModel.find({ studentId: { $in: studentIds } })
        .select("studentId fullName")
        .lean(),
    ]);

    const studentById = new Map(students.map((s) => [s._id.toString(), s]));
    const semesterById = new Map(semesters.map((s) => [s._id.toString(), s]));
    const profileByStudent = new Map(profiles.map((p) => [p.studentId.toString(), p]));
    const paidByStatement = new Map<string, number>();
    for (const p of payments) {
      if (p.status === "PAID") {
        const key = p.feeStatementId.toString();
        paidByStatement.set(key, (paidByStatement.get(key) ?? 0) + p.amount);
      }
    }

    return NextResponse.json(
      {
        statements: statements.map((s) => {
          const student = studentById.get(s.studentId.toString());
          return {
            id: s._id.toString(),
            statementNumber: s.statementNumber,
            registrationNumber: student?.registrationNumber ?? "—",
            studentName: profileByStudent.get(s.studentId.toString())?.fullName ?? "Name unavailable",
            currency: s.currency,
            billedAmount: s.billedAmount,
            paidAmount: paidByStatement.get(s._id.toString()) ?? 0,
            dueAt: s.dueAt,
            status: s.status,
            semester: semesterById.get(s.semesterId.toString()) ?? null,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin finance lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Admin finance lookup failed.");
  }
}
