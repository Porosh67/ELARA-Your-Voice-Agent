import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation / password-recovery callback.
 *
 * Supabase redirects here with a `code` query parameter after:
 *  - Google OAuth sign-in,
 *  - email address confirmation, and
 *  - a password-recovery link, which arrives as
 *    `/auth/callback?next=/reset-password`.
 *
 * We exchange the code for a session (which sets the auth cookies via the
 * server client) and then redirect the user into the app.
 *
 * OPEN-REDIRECT DEFENCE. `next` is attacker-controllable — it arrives in a URL
 * that is emailed, and anyone can craft one. It is therefore accepted ONLY when
 * it is a plain internal path: it must start with a single `/`, must not start
 * with `//` (protocol-relative, which browsers read as another host), must not
 * contain a backslash (some browsers normalise `\` to `/`, turning `/\evil.com`
 * into `//evil.com`), and must not carry a scheme or an authority. Anything else
 * falls back to `/app`. The same rule guards the value against `javascript:`
 * and `data:` URIs because those do not begin with `/`.
 */
function safeNextPath(value: string | null): string {
  if (typeof value !== "string" || value.length === 0) {
    return "/app";
  }

  if (!value.startsWith("/")) {
    return "/app";
  }

  // `//host` and `/\host` are both off-site once a browser normalises them.
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return "/app";
  }

  // Defence in depth against encoded variants of the same trick.
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/app";
  }

  if (decoded.startsWith("//") || decoded.startsWith("/\\") || decoded.includes("\\")) {
    return "/app";
  }

  if (/^\/+[a-z0-9+.-]*:/i.test(decoded)) {
    return "/app";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectPath = safeNextPath(searchParams.get("next"));

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