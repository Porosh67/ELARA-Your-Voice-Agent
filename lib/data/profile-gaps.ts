/**
 * THE PROFILE GAP RULES — pure, shared, and testable.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * Settings showed an empty Full name and Username for accounts created with
 * Google or email+password, even though those accounts plainly had both.
 *
 * The cause is a genuine tension between two requirements:
 *
 *   1. A profile row created with NULL fields must be FILLED from the auth
 *      provider's metadata.
 *   2. A field the person deliberately set must NEVER be overwritten.
 *
 * The signup trigger partially does (1) at insert time, but it can only see the
 * metadata present in that instant — which is empty for some flows and for
 * every account created before the trigger existed. Meanwhile the earlier
 * self-heal achieved (1) by UPSERTING, which also performed (2)'s opposite and
 * replaced a typed name with the email prefix on every page load. Fixing that
 * with ON CONFLICT DO NOTHING stopped the clobbering but left every empty field
 * empty forever.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * Write a field if and ONLY if it is currently empty, and take the best value
 * available in a fixed order. That is `buildProfileGapPatch`, and it lives here
 * — with no `server-only`, no database and no network — so the rules can be
 * tested directly rather than inferred from a page that happens to render.
 *
 * `lib/data/user-data.ts` applies the result; it does not define it.
 */

/** The subset of a Supabase user this module reads. */
export interface GapUser {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
  /** Provider-supplied claims: Google's `full_name`/`name`/`picture`, ours. */
  user_metadata?: Record<string, unknown> | null;
}

/** The only profile fields the gap rules may ever write. */
export interface ProfileGapPatch {
  display_name?: string;
  avatar_url?: string;
  username?: string;
}

/** Longest a derived name may be, matching the signup field's own cap. */
const MAX_NAME_LENGTH = 120;
const MAX_AVATAR_LENGTH = 300;
const MAX_USERNAME_LENGTH = 20;
/** Below this a derived handle cannot satisfy the format constraint. */
const MIN_USERNAME_LENGTH = 3;

/** The first non-blank string among the candidates, if any. */
function firstNonBlank(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

/** Whether a stored field should be treated as empty. */
function isBlank(value: string | null | undefined): boolean {
  return (value ?? "").trim().length === 0;
}

/**
 * Decide what to write into a profile, given what is already there.
 *
 * Returns ONLY the fields that are genuinely empty. Anything the person chose is
 * absent from the result, which is what makes applying it non-destructive and
 * safe to run on every page load.
 */
export function buildProfileGapPatch(
  user: GapUser,
  profile: ProfileGapPatch | { display_name: string | null; avatar_url: string | null; username: string | null }
): ProfileGapPatch {
  const metadata = user.user_metadata ?? {};
  const patch: ProfileGapPatch = {};

  /* ── Full name ──────────────────────────────────────────────────────────
     What the person typed beats the provider's own name, which beats the email
     prefix. The prefix is the LAST resort precisely because it is what the old
     upsert used to force on everybody. */
  if (isBlank(profile.display_name)) {
    const providerName = firstNonBlank([
      metadata.full_name,
      metadata.name,
      metadata.user_name,
      metadata.preferred_username,
    ]);

    const candidate = providerName ?? user.email?.split("@")[0]?.trim() ?? "";
    const next = candidate.slice(0, MAX_NAME_LENGTH);

    if (next.length > 0) {
      patch.display_name = next;
    }
  }

  /* ── Avatar ─────────────────────────────────────────────────────────────
     Providers supply one and nobody types one, so there is no risk of
     overwriting a choice. Google sends `avatar_url`; others send `picture`. */
  if (isBlank(profile.avatar_url)) {
    const avatar = firstNonBlank([metadata.avatar_url, metadata.picture]);

    if (avatar !== null) {
      patch.avatar_url = avatar.slice(0, MAX_AVATAR_LENGTH);
    }
  }

  /* ── Username ───────────────────────────────────────────────────────────
     Derived from the address prefix, cleaned to the allowed alphabet. NOT
     written for a guest: an anonymous account has no address to derive from and
     is meant to choose its own handle in Settings.

     A prefix that cleans down to fewer than 3 usable characters yields nothing
     rather than an invalid value, because the CHECK constraint would reject it
     and the whole write would fail — taking the valid name down with it. */
  if (isBlank(profile.username) && user.is_anonymous !== true) {
    const localPart = user.email?.split("@")[0] ?? "";
    const cleaned = localPart
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, MAX_USERNAME_LENGTH);

    if (cleaned.length >= MIN_USERNAME_LENGTH) {
      patch.username = cleaned;
    }
  }

  return patch;
}
