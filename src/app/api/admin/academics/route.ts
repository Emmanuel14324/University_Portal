import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  ProgrammeModel,
  CourseModel,
  SemesterModel,
  ProgrammeCourseModel,
} from "@/lib/models";
import { z } from "zod";

const createCourseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/),
  name: z.string().trim().min(2).max(120),
  department: z.string().trim().min(2).max(120),
  creditUnits: z.number().min(0.5).max(60),
  programmeId: z.string(),
  yearOfStudy: z.number().int().min(1).max(10),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    await connectToDatabase();
    const [programmes, courses, semesters] = await Promise.all([
      ProgrammeModel.find()
        .sort({ name: 1 })
        .select("_id code name award department durationYears isActive")
        .lean(),
      CourseModel.find()
        .sort({ code: 1 })
        .select("_id code name department creditUnits isActive")
        .lean(),
      SemesterModel.find()
        .sort({ startsOn: -1 })
        .select("_id academicYear name startsOn endsOn registrationOpensAt registrationClosesAt status")
        .lean(),
    ]);

    return NextResponse.json(
      { programmes, courses, semesters },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin academic reference lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Admin academic reference lookup failed.");
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  const parsed = createCourseSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide valid course details.", 400);

  try {
    await connectToDatabase();

    const programme = await ProgrammeModel.findOne({
      _id: new mongoose.Types.ObjectId(parsed.data.programmeId),
      isActive: true,
    }).lean();
    if (!programme) return jsonError("Select an active programme.", 400);

    const existing = await CourseModel.findOne({ code: parsed.data.code }).lean();
    if (existing) return jsonError("A course with that code already exists.", 409);

    const course = await CourseModel.create({
      code: parsed.data.code,
      name: parsed.data.name,
      department: parsed.data.department,
      creditUnits: parsed.data.creditUnits,
    });

    try {
      await ProgrammeCourseModel.create({
        programmeId: programme._id,
        courseId: course._id,
        yearOfStudy: parsed.data.yearOfStudy,
      });
    } catch (linkError) {
      await CourseModel.deleteOne({ _id: course._id });
      console.error("Could not link course to programme:", linkError instanceof Error ? linkError.message : linkError);
      return apiUnavailable("Could not assign the course to the selected programme.");
    }

    return NextResponse.json(
      { course: { id: course._id.toString(), code: course.code, name: course.name } },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Course creation failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Could not create the course.");
  }
}
