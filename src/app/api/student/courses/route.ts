import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable, getActiveStudentIdentity, StudentApiError } from "@/lib/api/students";
import { jsonError } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { CourseRegistrationModel, CourseModel, SemesterModel } from "@/lib/models";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  try {
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);

    await connectToDatabase();
    const registrations = await CourseRegistrationModel.find({
      studentId: new mongoose.Types.ObjectId(student.id),
    })
      .sort({ registeredAt: -1 })
      .select("_id status registeredAt courseId semesterId")
      .lean();

    if (!registrations.length) {
      return NextResponse.json({ courses: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const courseIds = [...new Set(registrations.map((r) => r.courseId.toString()))];
    const semesterIds = [...new Set(registrations.map((r) => r.semesterId.toString()))];

    const [courses, semesters] = await Promise.all([
      CourseModel.find({ _id: { $in: courseIds } })
        .select("_id code name department creditUnits")
        .lean(),
      SemesterModel.find({ _id: { $in: semesterIds } })
        .select("_id academicYear name startsOn endsOn")
        .lean(),
    ]);

    const courseById = new Map(courses.map((c) => [c._id.toString(), c]));
    const semesterById = new Map(semesters.map((s) => [s._id.toString(), s]));

    return NextResponse.json(
      {
        courses: registrations.map((r) => ({
          id: r._id.toString(),
          status: r.status,
          registeredAt: r.registeredAt,
          course: courseById.get(r.courseId.toString()) ?? null,
          semester: semesterById.get(r.semesterId.toString()) ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StudentApiError) return apiUnavailable("Student course lookup failed.");
    throw error;
  }
}
