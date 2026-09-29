import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";

/**
 * Admin Supabase client using the SERVICE ROLE key.
 *
 * SECURITY: This client bypasses Row Level Security. It must ONLY be used on
 * the server (Server Actions, Route Handlers, background jobs) and must never
 * be imported into Client Components. The `server-only` import enforces this at
 * build time.
 *
 * Not currently used by any UI flow — it exists as the foundation for future
 * server-side/admin tasks (guest cleanup, moderation, analytics).
 */
export function createAdminClient(): SupabaseClient {
  return createSupabaseClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}