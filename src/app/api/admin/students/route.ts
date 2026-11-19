import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  UserModel,
  StudentModel,
  StudentProfileModel,
  UserRoleModel,
  ProgrammeModel,
} from "@/lib/models";
import { sendInvitationEmail } from "@/lib/mongodb/email";
import { adminStudentSearchSchema } from "@/lib/validation/student";
import { z } from "zod";

const inviteStudentSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().toUpperCase().regex(/^STJ\/\d{4}\/\d{5,8}$/),
  admissionYear: z.number().int().min(1900).max(2200),
  yearOfStudy: z.number().int().min(1).max(10),
  programmeId: z.string().nullable(),
  status: z.enum(["APPLICANT", "ACTIVE"]),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = adminStudentSearchSchema.safeParse(params);
  if (!parsed.success) return jsonError("Invalid student search or pagination parameters.", 400);
  const { search, status, page, pageSize } = parsed.data;

  try {
    await connectToDatabase();

    // Build query filter
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    // Name search: find matching student IDs from profiles
    let matchingStudentIds: mongoose.Types.ObjectId[] | null = null;
    if (search) {
      const nameMatches = await StudentProfileModel.find({
        fullName: { $regex: search, $options: "i" },
      })
        .select("studentId")
        .lean();
      matchingStudentIds = nameMatches.map((m) => m.studentId);
    }

    if (search) {
      const regNumPattern = search.toUpperCase().replace(/,/g, "");
      const orClauses: Record<string, unknown>[] = [
        { registrationNumber: { $regex: regNumPattern, $options: "i" } },
      ];
      if (matchingStudentIds?.length) {
        orClauses.push({ _id: { $in: matchingStudentIds } });
      }
      filter.$or = orClauses;
    }

    const total = await StudentModel.countDocuments(filter);
    const students = await StudentModel.find(filter)
      .sort({ registrationNumber: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select("_id registrationNumber programmeId admissionYear yearOfStudy status createdAt")
      .lean();

    const studentIds = students.map((s) => s._id);
    const programmeIds = [
      ...new Set(
        students
          .map((s) => s.programmeId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [profiles, programmes] = await Promise.all([
      studentIds.length
        ? StudentProfileModel.find({ studentId: { $in: studentIds } })
            .select("studentId fullName")
            .lean()
        : [],
      programmeIds.length
        ? ProgrammeModel.find({ _id: { $in: programmeIds } })
            .select("_id code name")
            .lean()
        : [],
    ]);

    const profileByStudent = new Map(profiles.map((p) => [p.studentId.toString(), p]));
    const programmeById = new Map(programmes.map((p) => [p._id.toString(), p]));

    return NextResponse.json(
      {
        students: students.map((s) => ({
          id: s._id.toString(),
          registrationNumber: s.registrationNumber,
          admissionYear: s.admissionYear,
          yearOfStudy: s.yearOfStudy,
          status: s.status,
          profile: profileByStudent.get(s._id.toString()) ?? null,
          programme: s.programmeId ? (programmeById.get(s.programmeId.toString()) ?? null) : null,
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin student directory lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Admin student directory lookup failed.");
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  const parsed = inviteStudentSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide valid student and invitation details.", 400);

  await connectToDatabase();

  // Check for duplicates
  const [emailExists, regNumExists] = await Promise.all([
    UserModel.exists({ email: parsed.data.email.toLowerCase() }),
    StudentModel.exists({ registrationNumber: parsed.data.registrationNumber }),
  ]);
  if (emailExists) return jsonError("An account already exists for that email.", 409);
  if (regNumExists) return jsonError("That registration number is already in use.", 409);

  // Generate a temporary password
  const tempPassword =
    "Stj@" +
    Math.random().toString(36).slice(2, 8).toUpperCase() +
    Math.floor(100 + Math.random() * 900);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  let createdUserId: string | null = null;
  let createdStudentId: string | null = null;

  try {
    // Create auth user
    const user = await UserModel.create({
      email: parsed.data.email.toLowerCase(),
      passwordHash,
      fullName: parsed.data.fullName,
      isActive: true,
    });
    createdUserId = user._id.toString();

    // Assign role
    await UserRoleModel.create({
      userId: user._id,
      role: "STUDENT",
      assignedBy: new mongoose.Types.ObjectId(access.session.id),
    });

    // Create student record
    const student = await StudentModel.create({
      authUserId: user._id,
      registrationNumber: parsed.data.registrationNumber,
      admissionYear: parsed.data.admissionYear,
      yearOfStudy: parsed.data.yearOfStudy,
      programmeId: parsed.data.programmeId
        ? new mongoose.Types.ObjectId(parsed.data.programmeId)
        : null,
      status: parsed.data.status,
    });
    createdStudentId = student._id.toString();

    // Create profile
    await StudentProfileModel.create({
      studentId: student._id,
      fullName: parsed.data.fullName,
    });

    // Send invitation email (non-fatal)
    try {
      await sendInvitationEmail(
        parsed.data.email.toLowerCase(),
        parsed.data.fullName,
        tempPassword,
        "STUDENT",
      );
    } catch (emailError) {
      console.error("Student invitation email failed:", emailError instanceof Error ? emailError.message : emailError);
    }

    return NextResponse.json(
      { invited: true, registrationNumber: parsed.data.registrationNumber },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Manual rollback
    if (createdStudentId) {
      await StudentModel.deleteOne({ _id: createdStudentId }).catch((e) =>
        console.error("Student rollback failed:", e),
      );
      await StudentProfileModel.deleteOne({ studentId: createdStudentId }).catch((e) =>
        console.error("Profile rollback failed:", e),
      );
    }
    if (createdUserId) {
      await UserRoleModel.deleteOne({ userId: createdUserId }).catch((e) =>
        console.error("Role rollback failed:", e),
      );
      await UserModel.deleteOne({ _id: createdUserId }).catch((e) =>
        console.error("User rollback failed:", e),
      );
    }
    console.error("Student provisioning failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Could not create the student account.");
  }
}
