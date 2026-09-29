"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AuthActionState } from "@/lib/auth/action-state";
import { createClient } from "@/lib/supabase/server";

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

  if (!email || !password) {
    return { error: "Please enter both your email and password.", message: null };
  }

  if (password.length < 6) {
    return {
      error: "Password must be at least 6 characters long.",
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
    },
  });

  if (error) {
    return { error: error.message, message: null };
  }

  // If email confirmation is enabled, there is no active session yet.
  if (!data.session) {
    return {
      error: null,
      message:
        "Account created. Check your email to confirm your address, then log in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getSiteOrigin()}/auth/callback`,
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