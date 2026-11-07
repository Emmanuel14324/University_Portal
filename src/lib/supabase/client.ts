"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

let supabase: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  const { url, publishableKey } = getSupabaseConfig();

  supabase ??= createClient(url, publishableKey);
  return supabase;
}
