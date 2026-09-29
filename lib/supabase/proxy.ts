import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Refreshes the Supabase auth session on every request and keeps the response
 * cookies in sync.
 *
 * Next.js 16 note: this runs from the root `proxy.ts` file (the file convention
 * formerly known as `middleware.ts`). The proxy runs on the Node.js runtime by
 * default in Next 16.
 *
 * Important: do not run code between `createServerClient` and
 * `supabase.auth.getUser()` — the token refresh relies on those running
 * together.
 */
export async function updateSession(
  request: NextRequest
): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // IMPORTANT: do not remove. This refreshes the session and validates the user.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, userId: user?.id ?? null };
}