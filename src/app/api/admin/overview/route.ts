import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { connectToDatabase } from "@/lib/mongodb/connection";
import {
  StudentModel,
  CourseModel,
  ExaminationResultModel,
  UserSessionModel,
  SecurityAuditLogModel,
  UserModel,
} from "@/lib/models";

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    await connectToDatabase();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

    const [
      studentCount,
      courseCount,
      pendingResults,
      activeSessions,
      recentEvents,
      events,
      user,
    ] = await Promise.all([
      StudentModel.countDocuments({ status: "ACTIVE" }),
      CourseModel.countDocuments({ isActive: true }),
      ExaminationResultModel.countDocuments({ status: "DRAFT" }),
      UserSessionModel.countDocuments({ revokedAt: null, expiresAt: { $gt: now } }),
      SecurityAuditLogModel.countDocuments({ createdAt: { $gte: since } }),
      SecurityAuditLogModel.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select("actorUserId subjectUserId action entityType entityId details createdAt")
        .lean(),
      UserModel.findById(access.session.id).select("email fullName").lean(),
    ]);

    if (!user) return apiUnavailable("Admin dashboard lookup failed.");

    return NextResponse.json(
      {
        user: {
          email: user.email,
          name: user.fullName ?? user.email,
          role: access.session.role,
        },
        stats: {
          activeStudents: studentCount,
          activeCourses: courseCount,
          pendingResults,
          activeSessions,
          eventsLast24Hours: recentEvents,
        },
        events,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin dashboard lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Admin dashboard lookup failed.");
  }
}
