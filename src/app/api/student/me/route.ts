import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable, getActiveStudentIdentity, StudentApiError } from "@/lib/api/students";
import { jsonError } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { StudentProfileModel, ProgrammeModel, UserModel } from "@/lib/models";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  try {
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);

    await connectToDatabase();
    const [profile, programme, user] = await Promise.all([
      StudentProfileModel.findOne({ studentId: new mongoose.Types.ObjectId(student.id) })
        .select("fullName phoneNumber dateOfBirth address emergencyContactName emergencyContactPhone")
        .lean(),
      student.programme_id
        ? ProgrammeModel.findById(student.programme_id)
            .select("code name award department durationYears")
            .lean()
        : null,
      UserModel.findById(access.session.id).select("email").lean(),
    ]);

    return NextResponse.json(
      {
        student: {
          registrationNumber: student.registration_number,
          admissionYear: student.admission_year,
          yearOfStudy: student.year_of_study,
          status: student.status,
          email: user?.email ?? null,
          profile,
          programme,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StudentApiError) return apiUnavailable("Student identity lookup failed.");
    throw error;
  }
}
