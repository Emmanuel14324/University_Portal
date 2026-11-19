import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { jsonError } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  SecurityAuditLogModel,
  UserSessionModel,
  StudentModel,
  StudentProfileModel,
  UserModel,
} from "@/lib/models";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
  if (
    !Number.isInteger(page) || page < 1 || page > 100_000 ||
    !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50
  ) {
    return jsonError("Invalid security log pagination parameters.", 400);
  }

  try {
    await connectToDatabase();
    const skip = (page - 1) * pageSize;

    const [eventTotal, events, sessionTotal, sessions] = await Promise.all([
      SecurityAuditLogModel.countDocuments(),
      SecurityAuditLogModel.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select("actorUserId subjectUserId action entityType entityId details createdAt")
        .lean(),
      UserSessionModel.countDocuments(),
      UserSessionModel.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select("_id userId createdAt revokedAt expiresAt")
        .lean(),
    ]);

    const sessionUserIds = [...new Set(sessions.map((s) => s.userId.toString()))];
    const students = sessionUserIds.length
      ? await StudentModel.find({ authUserId: { $in: sessionUserIds } })
          .select("_id authUserId")
          .lean()
      : [];
    const studentIds = students.map((s) => s._id.toString());
    const profiles = studentIds.length
      ? await StudentProfileModel.find({ studentId: { $in: studentIds } })
          .select("studentId fullName")
          .lean()
      : [];

    const profileByUserId = new Map(
      students.map((s) => [
        s.authUserId.toString(),
        profiles.find((p) => p.studentId.toString() === s._id.toString())?.fullName,
      ]),
    );

    // For non-student users, look up name from User model
    const nonStudentUserIds = sessionUserIds.filter((id) => !profileByUserId.has(id));
    const adminUsers = nonStudentUserIds.length
      ? await UserModel.find({ _id: { $in: nonStudentUserIds } })
          .select("_id email fullName")
          .lean()
      : [];
    const adminNameById = new Map(adminUsers.map((u) => [u._id.toString(), u.fullName ?? u.email]));

    const now = Date.now();
    return NextResponse.json(
      {
        events,
        sessions: sessions.map((s) => ({
          id: s._id.toString(),
          userId: s.userId.toString(),
          userName:
            profileByUserId.get(s.userId.toString()) ??
            adminNameById.get(s.userId.toString()) ??
            "Name unavailable",
          loggedInAt: s.createdAt,
          loggedOutAt:
            s.revokedAt ?? (new Date(s.expiresAt).getTime() <= now ? s.expiresAt : null),
          status: s.revokedAt
            ? "Signed out"
            : new Date(s.expiresAt).getTime() <= now
              ? "Expired"
              : "Active",
        })),
        pagination: {
          page,
          pageSize,
          total: eventTotal,
          totalPages: Math.ceil(eventTotal / pageSize),
        },
        sessionPagination: {
          page,
          pageSize,
          total: sessionTotal,
          totalPages: Math.ceil(sessionTotal / pageSize),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin security log lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Admin security log lookup failed.");
  }
}
