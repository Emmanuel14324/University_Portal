import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { z } from "zod";

const settingSchema = z.object({
  key: z.enum(["academic_year", "registration_window", "portal_notifications", "access_policies"]),
  enabled: z.boolean(),
}).strict();

export async function GET(request: NextRequest) {
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;
  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("portal_settings")
      .select("key, value");
    if (error) return apiUnavailable("Portal settings lookup failed.");
    const settings = Object.fromEntries((data ?? []).map((item) => [item.key, item.value]));
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Portal settings lookup failed.");
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  const access = await authorizeApiRequest(request, ["ADMIN", "SUPER_ADMIN"]);
  if (access.response) return access.response;
  const parsed = settingSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide a valid portal setting.", 400);
  try {
    const { error } = await getSupabaseAdminClient()
      .from("portal_settings")
      .upsert({
        key: parsed.data.key,
        value: { enabled: parsed.data.enabled },
        updated_by: access.session.id,
        updated_at: new Date().toISOString(),
      });
    if (error) return apiUnavailable("Portal setting update failed.");
    return NextResponse.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return apiUnavailable("Portal settings service is not configured.");
    throw error;
  }
}
