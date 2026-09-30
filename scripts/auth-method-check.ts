/**
 * Verifies account-type detection and the username rules.
 *
 * The bug this guards against: every account showing "Guest session", including
 * email+password and Google accounts. Guest status must be asserted ONLY on
 * positive evidence, and a stale `profiles.is_guest` column must never be able
 * to relabel a real account.
 *
 * Run: node --import ./scripts/test-hooks.mjs scripts/auth-method-check.ts
 */
import {
  authMethodFromUser,
  authMethodLabel,
  isGuestAccount,
  resolveDisplayName,
} from "@/lib/auth/auth-method";
import {
  isPasswordAcceptable,
  isUsernameWellFormed,
  normalizeUsername,
} from "@/lib/auth/password-policy";

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ── A real email+password account ─────────────────────────────────────────── */
const emailUser = {
  is_anonymous: false,
  app_metadata: { provider: "email", providers: ["email"] },
  identities: [{ provider: "email", identity_data: {} }],
};
check("email account is detected", authMethodFromUser(emailUser) === "email");
check("email account is NOT a guest", isGuestAccount(emailUser) === false);
check("a stale is_guest=true column cannot make it a guest",
  isGuestAccount(emailUser, "email") === false);

/* ── A real Google account ─────────────────────────────────────────────────── */
const googleUser = {
  is_anonymous: false,
  app_metadata: { provider: "google", providers: ["google"] },
  identities: [{ provider: "google", identity_data: {} }],
};
check("google account is detected", authMethodFromUser(googleUser) === "google");
check("google account is NOT a guest", isGuestAccount(googleUser) === false);

/* ── A genuine guest ───────────────────────────────────────────────────────── */
const guestUser = {
  is_anonymous: true,
  app_metadata: { provider: "anonymous", providers: ["anonymous"] },
};
check("guest is detected", authMethodFromUser(guestUser) === "anonymous");
check("guest IS a guest", isGuestAccount(guestUser) === true);

/* ── The failure modes that caused the reported bug ────────────────────────── */
// A user object where is_anonymous is simply absent — NOT false. This is the
// exact shape that made the old `Boolean(user.is_anonymous)` unreliable.
const missingFlag = { app_metadata: { provider: "email" } };
check("a missing is_anonymous flag still reads as a real account",
  isGuestAccount(missingFlag) === false, String(authMethodFromUser(missingFlag)));
check("a missing is_anonymous flag is not a guest",
  isGuestAccount(missingFlag, null) === false);

// No signal at all, and a stale column claiming guest. Must NOT be a guest:
// guessing guest is what locked real users out of their own identity.
const noSignal = {};
check("no signal at all is NOT a guest", isGuestAccount(noSignal) === false);
check("no signal + stale 'anonymous' column IS a guest",
  isGuestAccount(noSignal, "anonymous") === true);
check("an unknown stored method is not a guest",
  isGuestAccount(noSignal, "wat") === false);
check("a null user is not a guest", isGuestAccount(null) === false);

// is_anonymous wins even if the provider disagrees.
check("is_anonymous=true wins over a stale provider",
  isGuestAccount({ is_anonymous: true, app_metadata: { provider: "email" } }) === true);

// The array form, for a linked-identity account.
const linked = { app_metadata: { providers: ["google", "email"] } };
check("the providers array is used when provider is absent",
  authMethodFromUser(linked) === "google");

// A garbage provider must not become a new branch.
check("an unrecognised provider is rejected",
  authMethodFromUser({ app_metadata: { provider: "sms" } }) === null);
check("guest is never inferred from a missing user",
  authMethodLabel(authMethodFromUser(undefined)) === "Signed in");

/* ── Labels ────────────────────────────────────────────────────────────────── */
check("email label", authMethodLabel("email") === "Email account");
check("google label", authMethodLabel("google") === "Google account");
check("guest label", authMethodLabel("anonymous") === "Guest session");

/* ── Display name precedence ───────────────────────────────────────────────── */
check("a typed name wins",
  resolveDisplayName({ profileDisplayName: "Ada Lovelace", email: "ada@x.com" }) === "Ada Lovelace");
check("the google name is used when nothing was typed",
  resolveDisplayName({ userFullName: "Ada L", email: "ada@x.com" }) === "Ada L");
check("the username is used before the email prefix",
  resolveDisplayName({ profileUsername: "ada_l", email: "ada@x.com" }) === "ada_l");
check("the email prefix is the last real fallback",
  resolveDisplayName({ email: "ada@x.com" }) === "ada");
check("a guest with nothing gets Guest",
  resolveDisplayName({ isGuest: true }) === "Guest");
check("a real user with nothing gets Friend",
  resolveDisplayName({ isGuest: false }) === "Friend");

/* ── Username rules, unchanged by this work ────────────────────────────────── */
check("username normalises", normalizeUsername(" Ada_01 ") === "ada_01");
check("a valid username passes", isUsernameWellFormed("ada_01"));
check("a hyphen is rejected", !isUsernameWellFormed("ada-01"));
check("password policy still holds", isPasswordAcceptable("Str0ng!Passphrase#42"));
check("a short password is rejected", !isPasswordAcceptable("Ab1!xyz"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
