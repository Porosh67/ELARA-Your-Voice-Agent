"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AuthActionState } from "@/lib/auth/action-state";
import { createClient } from "@/lib/supabase/server";
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_HINT,
  isPasswordAcceptable,
  isUsernameWellFormed,
  normalizeUsername,
} from "@/lib/auth/password-policy";

/**
 * Auth Server Actions.
 *
 * IMPORTANT: this is a `"use server"` module, so it may ONLY export async
 * functions. Never add a plain value, object, constant, class or re-exported
 * value here — it throws at runtime:
 *   Error: A "use server" file can only export async functions, found object.
 *
 * `AuthActionState` and `initialAuthState` therefore live in
 * `lib/auth/action-state.ts` (a plain module) and are imported from there.
 * Type-only imports are erased at compile time and are safe.
 */

/** Only allow same-origin relative redirects (prevents open-redirect attacks). */
function safeRedirectPath(value: unknown, fallback = "/app"): string {
  const path = typeof value === "string" ? value : "";
  if (path.startsWith("/") && !path.startsWith("//")) {
    return path;
  }
  return fallback;
}

/** Returns the absolute site origin for building OAuth redirect URLs. */
function getSiteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  );
}

/**
 * Turn Supabase's signup errors into something a person can act on.
 *
 * The raw message for a duplicate address is "User already registered", which
 * reads like a database complaint and, worse, is a free oracle for discovering
 * which addresses have accounts. The email is echoed back in the sentence only
 * so the person can see WHICH of their own fields was the problem — it is their
 * own input, and they just typed it.
 */
function friendlySignUpError(message: string, email: string): string {
  const lowered = message.toLowerCase();

  if (
    lowered.includes("already registered") ||
    lowered.includes("already been registered") ||
    lowered.includes("duplicate")
  ) {
    return `An account already exists for ${email}. Try logging in instead, or reset your password.`;
  }

  if (lowered.includes("password")) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, a number and a symbol.`;
  }

  if (lowered.includes("email") && lowered.includes("invalid")) {
    return "That doesn't look like a valid email address.";
  }

  if (lowered.includes("rate") || lowered.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }

  return "We couldn't create your account. Please try again.";
}

export async function signInWithPassword(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectPath(formData.get("redirect"));

  if (!email || !password) {
    return { error: "Please enter both your email and password.", message: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message, message: null };
  }

  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 120);
  const rawUsername = String(formData.get("username") ?? "").trim();

  if (!email || !password) {
    return { error: "Please enter both your email and password.", message: null };
  }

  const username = normalizeUsername(rawUsername);

  if (!isUsernameWellFormed(username)) {
    return {
      error: `Choose a username: ${USERNAME_HINT}`,
      message: null,
    };
  }

  /*
   * The shared policy, re-checked here because the disabled submit button is a
   * courtesy and not a control: this is the gate that actually holds.
   */
  if (!isPasswordAcceptable(password)) {
    return {
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, a number and a symbol.`,
      message: null,
    };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match.", message: null };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteOrigin()}/auth/callback`,
      // Read by the handle_new_user trigger. Metadata is a REQUEST, not a
      // guarantee: the trigger validates the format and stores NULL rather than
      // raising, and the unique index below is the real authority.
      data: { username, full_name: fullName || null },
    },
  });

  if (error) {
    return { error: friendlySignUpError(error.message, email), message: null };
  }

  // If email confirmation is enabled, there is no active session yet.
  if (!data.session) {
    return {
      error: null,
      message:
        "Account created. Check your email to confirm your address, then log in.",
    };
  }

  /*
   * The session exists, so the account is live. If someone took the username in
   * the gap between the availability check and this insert, the unique index
   * fired — but the trigger deliberately swallowed it so the ACCOUNT was still
   * created. Say so plainly rather than leaving a signed-in user with a handle
   * that silently is not theirs.
   */
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile?.username == null) {
      revalidatePath("/", "layout");
      redirect("/app?username=unavailable");
    }
  }

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();

  /*
   * GOOGLE CONSENT + ACCOUNT PICKER — forced on every attempt.
   *
   * Without `prompt`, Google skips the consent screen entirely once it has seen
   * the app before: the user picks a tile and is signed straight in, with no
   * "Elara wants to access your account" step. That is both a worse experience
   * and a weaker one — the person is never told what is being shared, and there
   * is no chance to notice the app is asking for the wrong thing.
   *
   * `consent`  forces the permissions screen every time.
   * `select_account` forces the account chooser, so signing in as a different
   *   person is possible without first signing the current one out — which is
   *   the single most common "I can't log in as my other account" report.
   * `access_type: 'offline'` asks for a refresh token, so a Google session can
   *   outlive the access token rather than dropping the user out mid-conversation.
   *
   * Both values are fixed strings written here, never taken from user input.
   */
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getSiteOrigin()}/auth/callback`,
      queryParams: {
        prompt: "consent select_account",
        access_type: "offline",
      },
    },
  });

  if (error || !data.url) {
    redirect("/login?error=google");
  }

  redirect(data.url);
}

export async function signInAsGuest(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInAnonymously();

  if (error) {
    redirect("/login?error=guest");
  }

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}