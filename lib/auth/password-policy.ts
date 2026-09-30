/**
 * THE PASSWORD POLICY — one source of truth.
 *
 * Shared by the signup form, the reset-password form and the server actions
 * that back them, so the rules a person is shown while typing are literally
 * the same rules the server enforces. Two implementations would drift, and the
 * drift is always in the direction that lets a weak password through.
 *
 * This module is deliberately dependency-free and safe to import from a Client
 * Component: it contains RULES, never a secret. A password is passed in to be
 * judged and is never stored, logged, or returned anywhere.
 */

/** Minimum length. Long, because length is the single strongest factor. */
export const PASSWORD_MIN_LENGTH = 16;

/** Longest accepted value — a bound so an enormous string cannot be posted. */
export const PASSWORD_MAX_LENGTH = 200;

export const PASSWORD_MAX_LENGTH_MESSAGE = `Passwords must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;

/** A username: 3-20 characters, lowercase letters, digits and underscore. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

export const USERNAME_HINT = "3–20 characters: lowercase letters, numbers and underscore.";

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

/**
 * The rules, in the order they are displayed.
 *
 * Each is a pure predicate over the string, so the same list drives the live
 * checklist, the meter, and the server-side gate.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "One lowercase letter",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "digit",
    label: "One number",
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: "symbol",
    label: "One symbol (for example ! @ # $ % ^ & *)",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
] as const;

/** The ids of the rules a password currently fails. */
export function unmetPasswordRules(password: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.id);
}

/** True only when every rule passes. The server's gate is exactly this. */
export function isPasswordAcceptable(password: string): boolean {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }

  return unmetPasswordRules(password).length === 0;
}

/** The strength meter's four segments, derived from the rules. */
export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

export const PASSWORD_STRENGTH_LABELS: Record<PasswordStrengthLevel, string> = {
  0: "Too short",
  1: "Weak",
  2: "Fair",
  3: "Strong",
  4: "Excellent",
};

/**
 * Score 0–4 from how many rules pass.
 *
 * Deliberately rule-based rather than an entropy estimate: the meter must never
 * say "Excellent" for a password the server will then reject, and one list
 * driving both makes that impossible.
 */
export function passwordStrengthLevel(password: string): PasswordStrengthLevel {
  if (password.length === 0) {
    return 0;
  }

  const met = PASSWORD_RULES.length - unmetPasswordRules(password).length;

  // 5 rules mapped onto 4 segments: reaching the top band needs the minimum
  // length plus three of the four character classes.
  if (met >= 5) return 4;
  if (met >= 4) return 3;
  if (met >= 3) return 2;
  if (met >= 2) return 1;
  return 0;
}

/** Normalise a typed username to the stored form. Never throws. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Whether a username is well-formed. Format only — not availability. */
export function isUsernameWellFormed(value: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(value));
}

/**
 * A human sentence for a malformed username, or `null` when it is fine.
 * Used for the inline error under the field.
 */
export function usernameFormatError(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return `Usernames need at least ${USERNAME_MIN_LENGTH} characters.`;
  }

  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.`;
  }

  if (!USERNAME_PATTERN.test(normalizeUsername(trimmed))) {
    return "Use lowercase letters, numbers and underscore only — no spaces or symbols.";
  }

  return null;
}
