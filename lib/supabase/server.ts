import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers.
 *
 * Next.js 16 note: `cookies()` is ASYNC — it must be awaited.
 *
 * Cookie writes (setAll) can throw when called from a Server Component (where
 * cookies are read-only). That is expected and safe to ignore here, because the
 * `proxy.ts` file is responsible for actually refreshing the session cookies.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — cookies are read-only.
          // Session refresh is handled by proxy.ts instead.
        }
      },
    },
  });
}