import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation callback.
 *
 * Supabase redirects here with a `code` query parameter after:
 *  - Google OAuth sign-in, and
 *  - email address confirmation.
 *
 * We exchange the code for a session (which sets the auth cookies via the
 * server client) and then redirect the user into the app.
 *
 * Always use a relative redirect target derived from the request origin to
 * avoid open-redirect vulnerabilities.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Only allow same-origin relative paths for the post-login destination.
  const redirectPath =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${redirectPath}`);
    }
  }

  // Something went wrong — send the user back to login with an error flag.
  return NextResponse.redirect(`${origin}/login?error=callback`);
}