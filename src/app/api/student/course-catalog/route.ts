import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable, getActiveStudentIdentity, StudentApiError } from "@/lib/api/students";
import { jsonError } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  SemesterModel,
  ProgrammeCourseModel,
  CourseRegistrationModel,
  CourseModel,
} from "@/lib/models";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  try {
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);

    await connectToDatabase();
    const now = new Date();

    const semesters = await SemesterModel.find({
      status: "REGISTRATION_OPEN",
      $or: [{ registrationOpensAt: null }, { registrationOpensAt: { $lte: now } }],
      $and: [
        { $or: [{ registrationClosesAt: null }, { registrationClosesAt: { $gte: now } }] },
      ],
    })
      .sort({ startsOn: 1 })
      .select("_id academicYear name startsOn endsOn registrationOpensAt registrationClosesAt")
      .lean();

    if (!student.programme_id || !semesters.length) {
      return NextResponse.json(
        { courses: [], semesters },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const [programmeCourses, currentRegistrations] = await Promise.all([
      ProgrammeCourseModel.find({
        programmeId: new mongoose.Types.ObjectId(student.programme_id),
        yearOfStudy: student.year_of_study,
      })
        .select("courseId")
        .lean(),
      CourseRegistrationModel.find({
        studentId: new mongoose.Types.ObjectId(student.id),
        status: "REGISTERED",
      })
        .select("courseId semesterId")
        .lean(),
    ]);

    const courseIds = [...new Set(programmeCourses.map((pc) => pc.courseId.toString()))];
    if (!courseIds.length) {
      return NextResponse.json(
        { courses: [], semesters },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const courses = await CourseModel.find({
      _id: { $in: courseIds },
      isActive: true,
    })
      .sort({ code: 1 })
      .select("_id code name department creditUnits")
      .lean();

    const semesterIdSet = new Set(semesters.map((s) => s._id.toString()));
    const registered = new Set(
      currentRegistrations
        .filter((r) => semesterIdSet.has(r.semesterId.toString()))
        .map((r) => r.courseId.toString()),
    );

    return NextResponse.json(
      {
        courses: courses.map((c) => ({ ...c, id: c._id.toString(), registered: registered.has(c._id.toString()) })),
        semesters,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StudentApiError) return apiUnavailable("Course catalog lookup failed.");
    throw error;
  }
}
