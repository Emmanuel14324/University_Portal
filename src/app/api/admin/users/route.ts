import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { UserModel, UserRoleModel } from "@/lib/models";
import { sendInvitationEmail } from "@/lib/mongodb/email";
import { z } from "zod";

const inviteAdminSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(["ADMIN", "SUPER_ADMIN"]),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    await connectToDatabase();
    const roles = await UserRoleModel.find({ role: { $in: ["ADMIN", "SUPER_ADMIN"] } })
      .sort({ assignedAt: -1 })
      .lean();

    const userIds = roles.map((r) => r.userId.toString());
    const users = await UserModel.find({ _id: { $in: userIds } })
      .select("_id email fullName")
      .lean();
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    return NextResponse.json(
      {
        users: roles.map((r) => {
          const u = userById.get(r.userId.toString());
          return {
            id: r.userId.toString(),
            email: u?.email ?? "Email unavailable",
            fullName: u?.fullName ?? u?.email ?? "Administrator",
            role: r.role,
            invitedAt: r.assignedAt,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Administrator directory lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Administrator directory lookup failed.");
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["SUPER_ADMIN"]);
  if (access.response) return access.response;

  const parsed = inviteAdminSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid email address, name, and administrator role.", 400);

  await connectToDatabase();
  const emailExists = await UserModel.exists({ email: parsed.data.email.toLowerCase() });
  if (emailExists) return jsonError("An account already exists for that email.", 409);

  const tempPassword =
    "Stj@" +
    Math.random().toString(36).slice(2, 8).toUpperCase() +
    Math.floor(100 + Math.random() * 900);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  let createdUserId: string | null = null;
  try {
    const user = await UserModel.create({
      email: parsed.data.email.toLowerCase(),
      passwordHash,
      fullName: parsed.data.fullName,
      isActive: true,
    });
    createdUserId = user._id.toString();

    const roleExists = await UserRoleModel.exists({ userId: user._id });
    if (roleExists) {
      await UserModel.deleteOne({ _id: user._id });
      return jsonError("That account already has an assigned role.", 409);
    }

    await UserRoleModel.create({
      userId: user._id,
      role: parsed.data.role,
      assignedBy: new mongoose.Types.ObjectId(access.session.id),
    });

    try {
      await sendInvitationEmail(
        parsed.data.email.toLowerCase(),
        parsed.data.fullName,
        tempPassword,
        parsed.data.role,
      );
    } catch (emailError) {
      console.error("Admin invitation email failed:", emailError instanceof Error ? emailError.message : emailError);
    }

    return NextResponse.json(
      { invited: true, email: parsed.data.email.toLowerCase() },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (createdUserId) {
      await UserModel.deleteOne({ _id: createdUserId }).catch((e) =>
        console.error("Admin rollback failed:", e),
      );
      await UserRoleModel.deleteOne({ userId: createdUserId }).catch((e) =>
        console.error("Admin role rollback failed:", e),
      );
    }
    console.error("Administrator invitation failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Could not create the administrator account.");
  }
}
