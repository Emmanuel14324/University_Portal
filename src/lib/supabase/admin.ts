import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  getSupabaseConfig,
  SupabaseConfigurationError,
} from "@/lib/supabase/config";

export function getSupabaseAdminClient() {
  const { url } = getSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!secretKey) {
    throw new SupabaseConfigurationError(
      "Set SUPABASE_SECRET_KEY in .env.local for trusted server operations.",
    );
  }

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
