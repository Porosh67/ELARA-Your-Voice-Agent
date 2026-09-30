import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit, clientIpFromHeaders } from "@/lib/auth/ip-rate-limit";

/**
 * THE ONE MESSAGE, whatever the input was.
 *
 * This route is an account-enumeration oracle unless it is perfectly constant.
 * A different response for "no such email" than for "no such username", or a
 * different status code, or a different latency, all leak the answer. So the
 * status is 200, the body is this exact sentence, and the work — resolving the
 * username, sending mail, failing — happens behind it every time.
 */
const GENERIC_MESSAGE =
  "If an account exists, a reset link has been sent. Check your inbox.";

/** Where the recovery link lands. The callback validates `next` itself. */
function resetRedirectTo(): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${origin}/auth/callback?next=/reset-password`;
}

export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  /*
   * Rate limited on BOTH axes. Per-IP stops one machine spraying identifiers;
   * per-identifier stops a botnet walking a list of emails from one IP. Without
   * the second, a 1000-address list is one request per second from a single
   * host, and the endpoint becomes a mail cannon aimed at other people.
   */
  const byIp = checkIpRateLimit(ip, {
    bucket: "forgot-ip",
    max: 5,
    windowMs: 60_000,
  });

  if (byIp.limited) {
    return NextResponse.json(
      { message: GENERIC_MESSAGE },
      { status: 200, headers: { "Retry-After": String(byIp.retryAfterSeconds) } }
    );
  }

  let identifier = "";

  try {
    const body = (await request.json()) as { identifier?: unknown };
    identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  } catch {
    return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
  }

  if (identifier.length === 0 || identifier.length > 320) {
    return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
  }

  const byIdentifier = checkIpRateLimit(identifier.toLowerCase(), {
    bucket: "forgot-id",
    max: 3,
    windowMs: 60_000,
  });

  if (byIdentifier.limited) {
    return NextResponse.json(
      { message: GENERIC_MESSAGE },
      { status: 200, headers: { "Retry-After": String(byIdentifier.retryAfterSeconds) } }
    );
  }

  let email = identifier;

  /*
   * A username is resolved to its email HERE, on the server, with the service
   * role — the browser is never trusted to supply an address, and the profiles
   * table stays owner-only under RLS. An unknown username simply resolves to
   * nothing and falls through to the same generic response.
   *
   * Guests (anonymous accounts) have no email at all, so they can never be
   * resolved or mailed — which is correct: there is no mailbox to reach.
   */
  if (!identifier.includes("@")) {
    const username = identifier.toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
    }

    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("profiles")
        .select("email")
        .eq("username", username)
        .not("email", "is", null)
        .limit(1)
        .maybeSingle();

      const resolved = data?.email ?? null;

      if (resolved === null) {
        // Unknown username. Answer exactly as if we had sent nothing.
        return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
      }

      email = resolved;
    } catch {
      return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
    }
  }

  try {
    const supabase = await createClient();

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectTo(),
    });
  } catch {
    // Swallowed on purpose: a provider failure must not become a different
    // answer, or the difference is the oracle.
  }

  return NextResponse.json(
    { message: GENERIC_MESSAGE },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
