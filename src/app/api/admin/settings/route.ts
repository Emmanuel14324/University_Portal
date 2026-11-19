import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { PortalSettingModel } from "@/lib/models";
import { z } from "zod";

const settingSchema = z.object({
  key: z.enum(["academic_year", "registration_window", "portal_notifications", "access_policies"]),
  enabled: z.boolean(),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  try {
    await connectToDatabase();
    const data = await PortalSettingModel.find().select("key value").lean();
    const settings = Object.fromEntries(data.map((item) => [item.key, item.value]));
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Portal settings lookup failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Portal settings lookup failed.");
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;

  const parsed = settingSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid portal setting.", 400);

  try {
    await connectToDatabase();
    await PortalSettingModel.findOneAndUpdate(
      { key: parsed.data.key },
      {
        key: parsed.data.key,
        value: { enabled: parsed.data.enabled },
        updatedBy: new mongoose.Types.ObjectId(access.session.id),
      },
      { upsert: true },
    );
    return NextResponse.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Portal setting update failed:", error instanceof Error ? error.message : error);
    return apiUnavailable("Portal setting update failed.");
  }
}
