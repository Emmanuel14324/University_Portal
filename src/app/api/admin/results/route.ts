import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  ExaminationResultModel,
  StudentModel,
  CourseRegistrationModel,
  CourseModel,
  SemesterModel,
  StudentProfileModel,
} from "@/lib/models";
import { z } from "zod";

const recordResultSchema = z.object({
  courseRegistrationId: z.string(),
  marks: z.number().min(0).max(100),
  grade: z.string().regex(/^[A-F][+]?-?$/),
  gradePoints: z.number().min(0).max(5),
  publish: z.boolean().default(false),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    await connectToDatabase();
    const [results, activeStudentCount, activeRegistrations] = await Promise.all([
      ExaminationResultModel.find()
        .sort({ createdAt: -1 })
        .limit(100)
        .select("courseRegistrationId marks grade gradePoints status publishedAt createdAt")
        .lean(),
      StudentModel.countDocuments({ status: "ACTIVE" }),
      CourseRegistrationModel.find({ status: "REGISTERED" })
        .sort({ registeredAt: -1 })
        .limit(500)
        .select("_id courseId semesterId studentId")
        .lean(),
    ]);

    const allRegistrationIds = [
      ...new Set([
        ...results.map((r) => r.courseRegistrationId.toString()),
        ...activeRegistrations.map((r) => r._id.toString()),
      ]),
    ];

    const registrations = allRegistrationIds.length
      ? await CourseRegistrationModel.find({ _id: { $in: allRegistrationIds } })
          .select("_id courseId semesterId studentId")
          .lean()
      : [];

    const courseIds = [...new Set(registrations.map((r) => r.courseId.toString()))];
    const semesterIds = [...new Set(registrations.map((r) => r.semesterId.toString()))];
    const studentIds = [...new Set(registrations.map((r) => r.studentId.toString()))];

    const [courses, semesters, students, profiles] = await Promise.all([
      courseIds.length
        ? CourseModel.find({ _id: { $in: courseIds } }).select("_id code name creditUnits").lean()
        : [],
      semesterIds.length
        ? SemesterModel.find({ _id: { $in: semesterIds } }).select("_id academicYear name").lean()
        : [],
      studentIds.length
        ? StudentModel.find({ _id: { $in: studentIds } }).select("_id registrationNumber").lean()
        : [],
      studentIds.length
        ? StudentProfileModel.find({ studentId: { $in: studentIds } })
            .select("studentId fullName")
            .lean()
        : [],
    ]);

    const registrationById = new Map(registrations.map((r) => [r._id.toString(), r]));
    const courseById = new Map(courses.map((c) => [c._id.toString(), c]));
    const semesterById = new Map(semesters.map((s) => [s._id.toString(), s]));
    const studentById = new Map(students.map((s) => [s._id.toString(), s]));
    const profileByStudent = new Map(profiles.map((p) => [p.studentId.toString(), p]));

    const listedResults = results.flatMap((result) => {
      const reg = registrationById.get(result.courseRegistrationId.toString());
      if (!reg) return [];
      return [{
        courseRegistrationId: result.courseRegistrationId.toString(),
        marks: result.marks,
        grade: result.grade,
        gradePoints: result.gradePoints,
        status: result.status,
        publishedAt: result.publishedAt,
        createdAt: result.createdAt,
        course: courseById.get(reg.courseId.toString()) ?? null,
        semester: semesterById.get(reg.semesterId.toString()) ?? null,
        student: {
          registrationNumber: studentById.get(reg.studentId.toString())?.registrationNumber ?? "—",
          fullName: profileByStudent.get(reg.studentId.toString())?.fullName ?? "Name unavailable",
        },
      }];
    });

    const registrationChoices = activeRegistrations.map((reg) => ({
      id: reg._id.toString(),
      studentName: profileByStudent.get(reg.studentId.toString())?.fullName ?? "Name unavailable",
      registrationNumber: studentById.get(reg.studentId.toString())?.registrationNumber ?? "—",
      course: courseById.get(reg.courseId.toString())?.code ?? "Course unavailable",
      semester: (() => {
        const sem = semesterById.get(reg.semesterId.toString());
        return sem ? `${sem.academicYear} · ${sem.name}` : "Semester unavailable";
      })(),
    }));

    return NextResponse.json(
      {
        results: listedResults,
        registrations: registrationChoices,
        activeStudents: activeStudentCount,
        pendingCount: listedResults.filter((r) => r.status === "DRAFT").length,
        publishedCount: listedResults.filter((r) => r.status === "PUBLISHED").length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin results lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Admin results lookup failed.");
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  const parsed = recordResultSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid course registration, mark, grade, and grade point value.", 400);

  try {
    await connectToDatabase();
    const registration = await CourseRegistrationModel.findOne({
      _id: new mongoose.Types.ObjectId(parsed.data.courseRegistrationId),
      status: "REGISTERED",
    }).lean();
    if (!registration) return jsonError("The course registration is not active.", 404);

    const result = await ExaminationResultModel.findOneAndUpdate(
      { courseRegistrationId: registration._id },
      {
        courseRegistrationId: registration._id,
        marks: parsed.data.marks,
        grade: parsed.data.grade,
        gradePoints: parsed.data.gradePoints,
        status: parsed.data.publish ? "PUBLISHED" : "DRAFT",
        publishedAt: parsed.data.publish ? new Date() : null,
        recordedBy: new mongoose.Types.ObjectId(access.session.id),
      },
      { upsert: true, new: true },
    ).lean();

    if (!result) return apiUnavailable("Could not save the examination result.");
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Admin result recording failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Could not save the examination result.");
  }
}
