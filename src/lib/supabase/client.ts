import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "../env.js";

let cachedClient: SupabaseClient | null = null;

export function createSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  cachedClient = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  return cachedClient;
}
