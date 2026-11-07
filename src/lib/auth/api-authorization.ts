import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/auth/http";
import {
  AppSessionError,
  getAppSession,
  getAppSessionCookieName,
  type AppRole,
} from "@/lib/auth/session";
import { roleCanAccess } from "@/lib/auth/policies";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export async function authorizeApiRequest(
  request: NextRequest,
  allowedRoles: readonly AppRole[],
) {
  const token = request.cookies.get(getAppSessionCookieName())?.value;
  if (!token) {
    return { session: null, response: jsonError("Authentication is required.", 401) };
  }

  try {
    const session = await getAppSession(token);
    if (!session) {
      return { session: null, response: jsonError("Authentication is required.", 401) };
    }
    if (!roleCanAccess(session.role, allowedRoles)) {
      return { session: null, response: jsonError("You do not have permission to access this resource.", 403) };
    }
    return { session, response: null };
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return { session: null, response: jsonError("Authentication service is not configured.", 503) };
    }
    if (error instanceof AppSessionError) {
      console.error("API session authorization failed:", error.message);
      return { session: null, response: jsonError("Could not validate the application session.", 503) };
    }
    throw error;
  }
}
