/**
 * HOW AN ACCOUNT IS IDENTIFIED — one source of truth.
 *
 * The bug this fixes: every account showed "Guest session", including ones
 * created with email+password and Google. The old check was
 * `profile.is_guest ?? Boolean(user.is_anonymous)`, which read a MUTABLE COLUMN
 * on the profiles row as the authority, and that column was being rewritten on
 * every page load by a self-heal whose upsert was doing DO UPDATE rather than
 * the DO NOTHING it claimed to do.
 *
 * ── THE ORDER OF AUTHORITY ──────────────────────────────────────────────────
 *
 * 1. `is_anonymous === true` on the auth user — GoTrue's own flag. This is the
 *    one thing that can say "guest" with certainty.
 * 2. `app_metadata.provider` — the provider GoTrue recorded at signup. Written
 *    by the auth server, NOT user-writable, so it cannot lie. 'email',
 *    'google', or 'anonymous'.
 * 3. `app_metadata.providers` — the array form, present when an account has
 *    linked more than one identity.
 * 4. The stored `profiles.auth_method` column, as a last resort.
 *
 * Critically, NOTHING here reads `profiles.is_guest` to decide. A stale or
 * corrupted column can no longer make a real account look like a guest, which
 * is precisely the failure being fixed.
 */

/** How an account was created. */
export type AuthMethod = "email" | "google" | "anonymous";

/** The subset of the Supabase user object this module reads. */
export interface AuthIdentifiableUser {
  is_anonymous?: boolean;
  app_metadata?: Record<string, unknown> | null;
  identities?: { provider?: string }[] | null;
}

/** Normalise anything unrecognised away, so a typo cannot become a new branch. */
function toAuthMethod(value: unknown): AuthMethod | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "email" || normalized === "google" || normalized === "anonymous") {
    return normalized;
  }

  return null;
}

/**
 * The account's method, resolved from Supabase's own record of it.
 *
 * Returns `null` only when the auth user carries no usable signal at all, which
 * should not happen — and in that case the caller falls back to the stored
 * column rather than guessing "guest", because guessing guest is what produced
 * the original bug.
 */
export function authMethodFromUser(user: AuthIdentifiableUser | null | undefined): AuthMethod | null {
  if (user == null) {
    return null;
  }

  // 1. The definitive guest flag. Checked FIRST and alone: if GoTrue says
  //    anonymous, nothing later can overturn it.
  if (user.is_anonymous === true) {
    return "anonymous";
  }

  const appMetadata = user.app_metadata ?? null;

  // 2. The scalar provider.
  const provider = toAuthMethod(appMetadata?.provider);
  if (provider !== null) {
    return provider;
  }

  // 3. The array form, when several identities are linked. The first known
  //    provider wins; an all-unknown array means we genuinely do not know.
  const providers = appMetadata?.providers;
  if (Array.isArray(providers)) {
    for (const entry of providers) {
      const candidate = toAuthMethod(entry);
      if (candidate !== null) {
        return candidate;
      }
    }
  }

  // 4. The linked-identity list, as a further fallback.
  const identities = user.identities;
  if (Array.isArray(identities)) {
    for (const identity of identities) {
      const candidate = toAuthMethod(identity?.provider);
      if (candidate !== null) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * The final answer: is this a guest?
 *
 * Guest is asserted ONLY on positive evidence — an explicit `is_anonymous`, a
 * provider of 'anonymous', or a stored method of 'anonymous'. Every other
 * outcome is a real account, because the failure mode of guessing is a real
 * user being told they are a guest and locked out of their own identity.
 */
export function isGuestAccount(
  user: AuthIdentifiableUser | null | undefined,
  storedMethod?: string | null
): boolean {
  const method = authMethodFromUser(user);

  if (method !== null) {
    return method === "anonymous";
  }

  return toAuthMethod(storedMethod) === "anonymous";
}

/** A short human label for the account type, for the UI. */
export function authMethodLabel(method: AuthMethod | null): string {
  switch (method) {
    case "google":
      return "Google account";
    case "email":
      return "Email account";
    case "anonymous":
      return "Guest session";
    default:
      return "Signed in";
  }
}

/**
 * The best display name available, preferring what the person chose.
 *
 * Order matters: a real name the user typed beats a Google name, which beats
 * the email prefix, which beats a neutral fallback. The old code fell straight
 * to the email prefix and so labelled everyone "ada" after typing "Ada Lovelace".
 */
export function resolveDisplayName(input: {
  profileDisplayName?: string | null;
  profileUsername?: string | null;
  userFullName?: string | null;
  userName?: string | null;
  email?: string | null;
  isGuest?: boolean;
}): string {
  const candidate = input.profileDisplayName?.trim();

  if (candidate != null && candidate.length > 0) {
    return candidate;
  }

  const providerName = input.userFullName?.trim() || input.userName?.trim();
  if (providerName != null && providerName.length > 0) {
    return providerName;
  }

  const username = input.profileUsername?.trim();
  if (username != null && username.length > 0) {
    return username;
  }

  const emailPrefix = input.email?.split("@")[0]?.trim();
  if (emailPrefix != null && emailPrefix.length > 0) {
    return emailPrefix;
  }

  return input.isGuest === true ? "Guest" : "Friend";
}
