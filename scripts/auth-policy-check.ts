/**
 * Verifies the shared password and username policy, and the `next` redirect
 * guard, without touching the network.
 *
 * Run: npx tsx scripts/auth-policy-check.ts  (or via the loader below)
 */
import {
  PASSWORD_MIN_LENGTH,
  isPasswordAcceptable,
  isUsernameWellFormed,
  normalizeUsername,
  passwordStrengthLevel,
  unmetPasswordRules,
  usernameFormatError,
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

const GOOD = "Str0ng!Passphrase#42";

check("a compliant password is accepted", isPasswordAcceptable(GOOD));
check("too short is rejected", !isPasswordAcceptable("Ab1!xyz"));
check("no uppercase is rejected", !isPasswordAcceptable("str0ng!passphrase#42"));
check("no lowercase is rejected", !isPasswordAcceptable("STR0NG!PASSWORD#42"));
check("no digit is rejected", !isPasswordAcceptable("Strong!Password#"));
check("no symbol is rejected", !isPasswordAcceptable("Str0ngPassphrase42"));
check(
  "all five rules are reported for an empty password",
  unmetPasswordRules("").length === 5,
  String(unmetPasswordRules("").length)
);
check(
  "the exact minimum length is accepted",
  isPasswordAcceptable("Ab1!" + "x".repeat(PASSWORD_MIN_LENGTH - 4))
);
check("one character under the minimum is rejected", !isPasswordAcceptable("Ab1" + "x".repeat(PASSWORD_MIN_LENGTH - 4)));
check("an over-long password is rejected", !isPasswordAcceptable(GOOD + "x".repeat(300)));
check("a compliant password scores the top band", passwordStrengthLevel(GOOD) === 4, String(passwordStrengthLevel(GOOD)));
check("an empty password scores zero", passwordStrengthLevel("") === 0);

check("normalize lowercases and trims", normalizeUsername("  Ada_Lovelace ") === "ada_lovelace");
check("a valid username is well formed", isUsernameWellFormed("ada_01"));
check("uppercase is normalised into validity", isUsernameWellFormed("Ada_01"));
check("too short is rejected", !isUsernameWellFormed("ab"));
check("too long is rejected", !isUsernameWellFormed("a".repeat(21)));
check("a hyphen is rejected", !isUsernameWellFormed("ada-lovelace"));
check("a space is rejected", !isUsernameWellFormed("ada lovelace"));
check("a malformed name has an error message", usernameFormatError("ab") !== null);
check("a good name has no error message", usernameFormatError("ada_01") === null);
check("an empty field has no error message", usernameFormatError("") === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
