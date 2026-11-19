import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  StudentModel,
  CourseRegistrationModel,
  CourseModel,
  SemesterModel,
  ProgrammeCourseModel,
} from "@/lib/models";
import { studentCourseRegistrationSchema } from "@/lib/validation/student";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  const parsed = studentCourseRegistrationSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid course and semester.", 400);

  try {
    await connectToDatabase();

    const student = await StudentModel.findOne({ authUserId: access.session.id })
      .select("_id programmeId yearOfStudy status")
      .lean();
    if (!student || student.status !== "ACTIVE") {
      return jsonError("An active student account is required.", 403);
    }

    // Validate course exists and is active
    const course = await CourseModel.findOne({
      _id: new mongoose.Types.ObjectId(parsed.data.courseId),
      isActive: true,
    }).lean();
    if (!course) return jsonError("The course is unavailable or not active.", 409);

    // Validate semester is open for registration
    const now = new Date();
    const semester = await SemesterModel.findOne({
      _id: new mongoose.Types.ObjectId(parsed.data.semesterId),
      status: "REGISTRATION_OPEN",
      $or: [{ registrationOpensAt: null }, { registrationOpensAt: { $lte: now } }],
      $and: [
        { $or: [{ registrationClosesAt: null }, { registrationClosesAt: { $gte: now } }] },
      ],
    }).lean();
    if (!semester) return jsonError("Course registration is not open for the selected semester.", 409);

    // Check the course is in this student's programme and year
    if (student.programmeId) {
      const linked = await ProgrammeCourseModel.exists({
        programmeId: student.programmeId,
        courseId: course._id,
        yearOfStudy: student.yearOfStudy,
      });
      if (!linked) return jsonError("You are not eligible to register for this course.", 409);
    }

    // Check for duplicate
    const already = await CourseRegistrationModel.exists({
      studentId: student._id,
      courseId: course._id,
      semesterId: semester._id,
      status: "REGISTERED",
    });
    if (already) return jsonError("You are already registered for this course in that semester.", 409);

    const registration = await CourseRegistrationModel.create({
      studentId: student._id,
      courseId: course._id,
      semesterId: semester._id,
      status: "REGISTERED",
      registeredAt: now,
    });

    return NextResponse.json(
      { registered: true, registrationId: registration._id.toString() },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Course registration failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Course registration request failed.");
  }
}
