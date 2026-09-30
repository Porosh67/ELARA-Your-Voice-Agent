import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit, clientIpFromHeaders } from "@/lib/auth/ip-rate-limit";
import { USERNAME_PATTERN } from "@/lib/auth/password-policy";

/**
 * Is this username free?
 *
 * WHY A ROUTE AT ALL: the `profiles` table is owner-only under RLS, and it must
 * stay that way — a username must never become a public directory. So a signed
 * OUT visitor cannot ask the database directly, and the answer has to come from
 * the server, which reads with the service role.
 *
 * The response is deliberately the SMALLEST useful shape: `{available}` and
 * nothing else. It never returns a profile, a user id, an email, or a count of
 * how many people share a name — so this endpoint cannot be used to harvest the
 * user base even though it necessarily reveals whether ONE name is taken.
 *
 * Availability is a HINT. The unique index on lower(username) is the only real
 * authority, because two people can pass this check at the same moment. Signup
 * treats a collision as an ordinary, friendly "that one's taken" rather than an
 * error.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);
  const limit = checkIpRateLimit(ip, { bucket: "username", max: 30, windowMs: 60_000 });

  if (limit.limited) {
    return NextResponse.json(
      { available: false },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  let candidate: unknown;

  try {
    const body = (await request.json()) as { username?: unknown };
    candidate = body.username;
  } catch {
    return NextResponse.json({ available: false }, { status: 400 });
  }

  if (typeof candidate !== "string") {
    return NextResponse.json({ available: false }, { status: 400 });
  }

  // Normalise exactly as signup and the CHECK constraint will.
  const username = candidate.trim().toLowerCase();

  // A malformed username is not "available" — it can never be registered, and
  // answering otherwise would make the form promise something signup cannot do.
  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ available: false }, { status: 200 });
  }

  try {
    const admin = createAdminClient();

    // Case-insensitive, matching the unique index on lower(username) exactly.
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .limit(1)
      .maybeSingle();

    if (error) {
      // Never leak the database error to the browser. Reporting "available"
      // on a failure would let someone register a name the index will reject;
      // reporting "taken" would be a lie. The signup path re-checks properly.
      return NextResponse.json({ available: false }, { status: 200 });
    }

    return NextResponse.json(
      { available: data === null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
