import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit, clientIpFromHeaders } from "@/lib/auth/ip-rate-limit";

/**
 * DELETE AN ACCOUNT AND EVERYTHING IT OWNS.
 *
 * ── WHY THE SERVICE ROLE, CAREFULLY ─────────────────────────────────────────
 *
 * RLS makes the common path impossible: a user can only ever see and touch their
 * OWN rows, and there is no RLS policy that permits deleting the row that
 * describes you. So this route verifies WHO the caller is with the user-scoped
 * client, then does the removal itself with the service role against that
 * verified id — never against an id the request supplied.
 *
 * The id used below is ALWAYS `user.id` from `getUser()`. Nothing in the request
 * body can influence which account is deleted.
 *
 * ── WHY THE DELETES ARE EXPLICIT ─────────────────────────────────────────────
 *
 * Every table declares ON DELETE CASCADE toward auth.users, so deleting the auth
 * user would cascade on its own. The rows are removed explicitly anyway, for two
 * reasons: it works even against a database whose cascades were never applied,
 * and a partial failure is then visible — if the messages are gone but the
 * profile is not, that is a bug worth seeing rather than a silent half-state.
 *
 * Order matters and is child-first: messages reference conversations, so removing
 * conversations while messages remain would fail on the messages->conversations
 * foreign key.
 */

/** The exact word required. Case-sensitive, compared again on the server. */
const CONFIRMATION_WORD = "DELETE";

/** Deletion is rare and irreversible; the budget is deliberately tight. */
const DELETE_LIMIT = { max: 3, windowMs: 60_000 } as const;

export async function POST(request: NextRequest) {
  /* ── 1. ORIGIN — refuse a cross-site POST ──────────────────────────────────
     Same-origin check first and unconditional. Without it, any page on the web
     could POST here with a victim's cookies attached and delete their account
     by driving their browser. */
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;

  if (origin !== null && origin !== requestOrigin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* ── 2. IDENTITY — getUser(), never getSession() ──────────────────────────
     `getSession()` reads a JWT out of a cookie and trusts its claims. Only
     `getUser()` re-validates the token against the auth server, so a tampered
     or expired cookie cannot claim to be anybody. */
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError !== null || user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  /* ── 3. RATE LIMIT ────────────────────────────────────────────────────────
     Keyed on the verified user id and, separately, on the caller's IP, so one
     account cannot hammer the endpoint and one IP cannot cycle accounts. */
  const ip = clientIpFromHeaders(request.headers);

  const byUser = checkIpRateLimit(user.id, {
    bucket: "delete-user",
    ...DELETE_LIMIT,
  });
  const byIp = checkIpRateLimit(ip, { bucket: "delete-ip", ...DELETE_LIMIT });

  if (byUser.limited || byIp.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(byUser.retryAfterSeconds, byIp.retryAfterSeconds)
          ),
        },
      }
    );
  }

  /* ── 4. CONFIRMATION — re-checked here, not trusted from the client ───────
     The disabled button is a courtesy. This is the control. */
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const confirm =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { confirm?: unknown }).confirm
      : undefined;

  if (confirm !== CONFIRMATION_WORD) {
    return NextResponse.json(
      { error: `Type ${CONFIRMATION_WORD} exactly to confirm` },
      { status: 400 }
    );
  }

  /* ── 5. DELETE — child-first, against the verified id only ──────────────── */
  const admin = createAdminClient();

  /**
   * Child-first, so no statement is ever blocked by a foreign key whose target
   * has not been removed yet: messages reference conversations, so conversations
   * must not go first.
   *
   * `profiles` is keyed by `id` rather than `user_id` — its own primary key IS
   * the user's uuid — so it is listed with the column it filters on.
   */
  const tables: { name: string; column: "user_id" | "id" }[] = [
    { name: "messages", column: "user_id" },
    { name: "conversations", column: "user_id" },
    { name: "settings", column: "user_id" },
    { name: "profiles", column: "id" },
  ];

  /** Which step failed, if any. Names the table, never the database message. */
  let failedTable: string | null = null;

  for (const table of tables) {
    const { error } = await admin
      .from(table.name)
      .delete()
      .eq(table.column, user.id);

    if (error !== null && failedTable === null) {
      failedTable = table.name;
    }
  }

  // The auth user itself. Cascades are asserted by the migration, so this also
  // sweeps up anything the explicit deletes above missed.
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);

  if (deleteUserError) {
    return NextResponse.json(
      {
        error: "We couldn't finish deleting your account. Please try again.",
        stage: failedTable ?? "auth",
      },
      { status: 500 }
    );
  }

  /*
   * End this browser's session. The auth user is gone, so the cookies now point
   * at nothing; clearing them means a later visit is a clean signed-out state
   * rather than a stale session being retried on every request.
   */
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true }, { status: 200 });
}
