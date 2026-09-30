/**
 * Verifies the profile GAP rules — the fix for "Settings shows an empty Full
 * name and Username after Google or email sign-in".
 *
 * The two requirements in tension: a row created with NULL fields must be
 * FILLED, and a value the person chose must never be OVERWRITTEN. These cases
 * pin both, because the bug that started all of this was an upsert that did the
 * second when it meant to do the first.
 *
 * Run: node --import ./scripts/test-hooks.mjs scripts/profile-gap-check.ts
 */
import { buildProfileGapPatch } from "@/lib/data/profile-gaps";

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

const EMPTY = { display_name: null, avatar_url: null, username: null } as const;

/* ── GOOGLE: the reported case ────────────────────────────────────────────── */
const googleUser = {
  id: "u1",
  email: "ada.lovelace@gmail.com",
  is_anonymous: false,
  user_metadata: {
    full_name: "Ada Lovelace",
    name: "Ada Lovelace",
    avatar_url: "https://lh3.googleusercontent.com/a/abc",
  },
};

const googlePatch = buildProfileGapPatch(googleUser, EMPTY);
check("google fills the full name", googlePatch.display_name === "Ada Lovelace", String(googlePatch.display_name));
check(
  "google derives a username from the address, domain stripped",
  googlePatch.username === "adalovelace",
  String(googlePatch.username)
);
check("google fills the avatar", typeof googlePatch.avatar_url === "string");

/* ── GOOGLE: a second provider that sends only `name` ──────────────────────── */
const onlyName = buildProfileGapPatch(
  { id: "u2", email: "grace@gmail.com", user_metadata: { name: "Grace Hopper" } },
  EMPTY
);
check("provider `name` is used when `full_name` is absent", onlyName.display_name === "Grace Hopper");

/* ── EMAIL/PASSWORD: the other reported case ──────────────────────────────── */
const emailUser = {
  id: "u3",
  email: "alan.turing@example.com",
  is_anonymous: false,
  user_metadata: { full_name: "Alan Turing", username: "alan_turing" },
};
const emailPatch = buildProfileGapPatch(emailUser, EMPTY);
check("email signup fills the typed name", emailPatch.display_name === "Alan Turing");
check(
  "email signup derives a username from the address",
  emailPatch.username === "alanturing",
  String(emailPatch.username)
);

/* ── THE REGRESSION THAT MATTERS MOST: never overwrite ────────────────────── */
const chosen = {
  display_name: "Ada Lovelace",
  avatar_url: "https://example.test/mine.png",
  username: "ada_the_first",
};
const noOverwrite = buildProfileGapPatch(googleUser, chosen);
check("a chosen name is NEVER overwritten", noOverwrite.display_name === undefined);
check("a chosen username is NEVER overwritten", noOverwrite.username === undefined);
check("a chosen avatar is NEVER overwritten", noOverwrite.avatar_url === undefined);
check("a complete profile produces no patch at all", Object.keys(noOverwrite).length === 0);

/* ── Whitespace counts as empty ───────────────────────────────────────────── */
const blankish = buildProfileGapPatch(emailUser, {
  display_name: "   ",
  avatar_url: "",
  username: "  ",
});
check("whitespace-only fields count as empty", blankish.display_name === "Alan Turing");
check("whitespace username is refilled", blankish.username === "alanturing", String(blankish.username));

/* ── GUESTS get no derived username ───────────────────────────────────────── */
const guest = buildProfileGapPatch(
  { id: "g1", is_anonymous: true, email: null, user_metadata: {} },
  EMPTY
);
check("a guest gets no derived username", guest.username === undefined);
check("a guest gets no derived name", guest.display_name === undefined);

/* ── Degenerate emails produce no invalid username ────────────────────────── */
const shortPrefix = buildProfileGapPatch(
  { id: "u4", email: "a@x.com", user_metadata: {} },
  EMPTY
);
check("a prefix under 3 chars yields no username", shortPrefix.username === undefined);
check("but a name is still filled from the prefix", shortPrefix.display_name === "a");

const allSymbols = buildProfileGapPatch(
  { id: "u5", email: "!!!@x.com", user_metadata: {} },
  EMPTY
);
check("an all-symbol prefix yields no username", allSymbols.username === undefined);

const cleaned = buildProfileGapPatch(
  { id: "u6", email: "Ada.Lovelace-Smith@x.com", user_metadata: {} },
  EMPTY
);
check(
  "punctuation is REMOVED (not converted) from a derived username",
  cleaned.username === "adalovelacesmith",
  String(cleaned.username)
);

const truncated = buildProfileGapPatch(
  { id: "u7", email: "averyveryverylongemailprefix@example.com", user_metadata: {} },
  EMPTY
);
check("a derived username is capped at 20 chars", truncated.username?.length === 20, String(truncated.username?.length));

/* ── A very long provider name is bounded ─────────────────────────────────── */
const longName = buildProfileGapPatch(
  { id: "u8", email: "x@y.com", user_metadata: { full_name: "N".repeat(500) } },
  EMPTY
);
check("a long name is capped at 120 chars", longName.display_name?.length === 120);

/* ── No email and no metadata: nothing is invented ────────────────────────── */
const nothing = buildProfileGapPatch({ id: "u9" }, EMPTY);
check("nothing is invented with no email and no metadata", Object.keys(nothing).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
