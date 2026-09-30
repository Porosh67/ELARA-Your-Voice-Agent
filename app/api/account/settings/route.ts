import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkIpRateLimit } from "@/lib/auth/ip-rate-limit";
import { normalizeUsername, isUsernameWellFormed } from "@/lib/auth/password-policy";

/**
 * Read or write this user's preferences.
 *
 * Reads use `getUser()` rather than `getSession()`. The difference matters: a
 * JWT read from a cookie is only as trustworthy as the cookie, whereas
 * `getUser()` re-verifies the token with the auth server, so a forged or expired
 * token cannot act as a user here.
 *
 * RLS applies to every write, so this route cannot touch another account's row
 * even if the caller asked it to.
 */

/** The only fields a client may set. Anything else is ignored, not rejected. */
const ALLOWED = {
  preferred_language: (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= 16
      ? value
      : null,
  tts_voice: (value: unknown): string | null =>
    typeof value === "string" && value.length <= 200 ? value : null,
  tts_rate: (value: unknown): number | null => {
    // The column's own CHECK is 0.10–3.00; validated here so a bad value is
    // reported as a bad request instead of a constraint violation.
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return value >= 0.1 && value <= 3 ? Math.round(value * 100) / 100 : null;
  },
  theme: (value: unknown): string | null =>
    typeof value === "string" &&
    ["light", "dark", "system"].includes(value.toLowerCase())
      ? value.toLowerCase()
      : null,
  memory_enabled: (value: unknown): boolean | null =>
    typeof value === "boolean" ? value : null,
} as const;

type Field = keyof typeof ALLOWED;

/**
 * How often a username may be changed. Mirrored by the
 * `enforce_username_cooldown` trigger in migration 0003 — this constant exists
 * to produce a human-readable date, not to be the enforcement.
 */
const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Fields that accept an explicit `null` (clearing a chosen voice). */
const NULLABLE: Field[] = ["tts_voice"];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Self-heal on read, so a deleted settings row is recreated rather than the
  // page silently showing defaults that will not persist.
  const { data: existing } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing !== null) {
    return NextResponse.json({ settings: existing }, { status: 200 });
  }

  const { data: created, error } = await supabase
    .from("settings")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not load settings" }, { status: 500 });
  }

  return NextResponse.json({ settings: created }, { status: 200 });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Keyed on the verified user id, not the IP: these are the user's own
  // preferences, and a shared office NAT must not make preferences fail to save.
  const limit = checkIpRateLimit(user.id, {
    bucket: "settings",
    max: 60,
    windowMs: 60_000,
  });

  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many changes, slow down a moment" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const patch: Record<string, string | number | boolean | null> = {};
  const rejected: string[] = [];

  for (const [key, validate] of Object.entries(ALLOWED)) {
    const record = body as Record<string, unknown>;

    if (!(key in record)) {
      continue;
    }

    const raw = record[key];

    if (raw === null) {
      if (NULLABLE.includes(key as Field)) {
        patch[key] = null;
      } else {
        rejected.push(key);
      }
      continue;
    }

    const value = validate(raw);

    if (value === null) {
      rejected.push(key);
      continue;
    }

    patch[key] = value;
  }

  if (rejected.length > 0) {
    return NextResponse.json(
      { error: `Invalid value for: ${rejected.join(", ")}` },
      { status: 400 }
    );
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, changed: 0 }, { status: 200 });
  }

  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });

  if (error) {
    // A code, never the message: PostgREST messages can name columns and
    // constraints, and this route has no need to describe the schema.
    return NextResponse.json(
      { error: "Could not save settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, changed: Object.keys(patch).length }, { status: 200 });
}

/* ──────────────────────────────────────────────────────────────────────────
   PROFILE
   ────────────────────────────────────────────────────────────────────────── */

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const limit = checkIpRateLimit(user.id, {
    bucket: "profile",
    max: 10,
    windowMs: 60_000,
  });

  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many changes, slow down a moment" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const patch: { display_name?: string; username?: string | null } = {};

  if ("display_name" in record) {
    if (typeof record.display_name !== "string") {
      return NextResponse.json({ error: "Invalid display name" }, { status: 400 });
    }
    patch.display_name = record.display_name.trim().slice(0, 120);
  }

  if ("username" in record) {
    if (record.username === null || record.username === "") {
      // Releasing a handle is allowed, and frees it for someone else.
      patch.username = null;
    } else {
      if (typeof record.username !== "string") {
        return NextResponse.json({ error: "Invalid username" }, { status: 400 });
      }

      const username = normalizeUsername(record.username);

      if (!isUsernameWellFormed(username)) {
        return NextResponse.json(
          {
            error:
              "Usernames are 3–20 characters: lowercase letters, numbers and underscore.",
          },
          { status: 400 }
        );
      }

      /*
       * THE 7-DAY COOLDOWN — checked here for a USEFUL message, and enforced for
       * REAL by the `enforce_username_cooldown` database trigger.
       *
       * Two layers on purpose. This one can say "you can change it again on the
       * 12th", which a constraint cannot. The trigger is the actual guarantee:
       * it holds for every writer, including the table editor and any future
       * script, and it cannot be forgotten or raced past by two simultaneous
       * requests that both read a stale `username_changed_at`.
       */
      const { data: current } = await supabase
        .from("profiles")
        .select("username, username_changed_at")
        .eq("id", user.id)
        .maybeSingle<{ username: string | null; username_changed_at: string | null }>();

      const previous = current?.username ?? null;
      const changedAt = current?.username_changed_at ?? null;

      // Re-submitting the SAME handle is not a change, and must never lock
      // anybody out of saving the rest of their profile.
      if (username !== previous && changedAt !== null) {
        const nextAvailable = new Date(changedAt).getTime() + USERNAME_COOLDOWN_MS;
        const remaining = nextAvailable - Date.now();

        if (remaining > 0) {
          return NextResponse.json(
            {
              error: `You can change your username again on ${new Date(
                nextAvailable
              ).toLocaleDateString()}.`,
              retryAfter: Math.ceil(remaining / 1000),
            },
            { status: 429 }
          );
        }
      }

      patch.username = username;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, profile: null }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, ...patch }, { onConflict: "id" })
    .select("id, display_name, username, email")
    .single();

  if (error) {
    // The cooldown trigger. Reachable only in a genuine race — two requests
    // that both read a stale `username_changed_at` and both passed the check
    // above — so the trigger is what actually settles it.
    if (error.code === "P0001" && error.message.includes("username_cooldown")) {
      return NextResponse.json(
        { error: "You can only change your username once every 7 days." },
        { status: 429 }
      );
    }

    // 23505 = unique_violation, i.e. the username index.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That username is already taken" },
        { status: 409 }
      );
    }

    // A code, never the message: PostgREST messages can name columns and
    // constraints, and this route has no need to describe the schema.
    return NextResponse.json(
      { error: "Could not save your profile" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, profile: data }, { status: 200 });
}
