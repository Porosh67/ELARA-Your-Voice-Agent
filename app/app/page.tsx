import { redirect } from "next/navigation";
import Link from "next/link";
import { User, Settings as SettingsIcon, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { VoiceConsole } from "@/components/app/voice-console";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ensureUserRows } from "@/lib/data/user-data";
import {
  authMethodFromUser,
  authMethodLabel,
  isGuestAccount,
  resolveDisplayName,
} from "@/lib/auth/auth-method";
import type { Profile } from "@/types/database";

/**
 * Protected application route.
 *
 * Defense-in-depth: even though `proxy.ts` guards `/app`, this Server Component
 * re-checks the session server-side (the recommended pattern) before rendering.
 * Only the chrome is themed — the auth logic is unchanged.
 */
export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/app");
  }

  /*
   * SELF-HEAL ON LOAD.
   *
   * The `handle_new_user` trigger normally creates the profile and settings
   * rows at signup, so this is normally a no-op. It exists because rows can go
   * missing for reasons the trigger cannot prevent — a hand edit in the table
   * editor, a partial restore, a database created before the trigger existed —
   * and a single missing row would otherwise make every later write a silent
   * no-op forever, with the UI claiming history is saved when it is not.
   *
   * `ensureUserRows` uses INSERT ... ON CONFLICT DO NOTHING, so an existing row
   * keeps its real values; this can only ever fill a genuine gap.
   */
  const { profile: healedProfile, settings } = await ensureUserRows(user);
  const profile = healedProfile as Profile | null;

  /*
   * THE "EVERYONE IS A GUEST" FIX.
   *
   * Guest status is resolved from Supabase's OWN record of the account —
   * `is_anonymous` and `app_metadata.provider` — never from the mutable
   * `profiles.is_guest` column, which a buggy self-heal used to rewrite on
   * every page load. A stale or corrupted column can no longer relabel a real
   * account as a guest.
   */
  // The stored column is an untrusted STRING, so it is only used when Supabase
  // itself gave us nothing — and `authMethodLabel` treats anything unknown as
  // "Signed in" rather than defaulting to guest.
  const authMethod =
    authMethodFromUser(user) ??
    (profile?.auth_method === "email" ||
    profile?.auth_method === "google" ||
    profile?.auth_method === "anonymous"
      ? profile.auth_method
      : null);
  const isGuest = isGuestAccount(user, profile?.auth_method);
  const displayName = resolveDisplayName({
    profileDisplayName: profile?.display_name,
    profileUsername: profile?.username,
    userFullName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    userName: user.user_metadata?.user_name ?? null,
    email: profile?.email ?? user.email ?? null,
    isGuest,
  });

  return (
    <div className="relative flex min-h-screen flex-1 flex-col">
      <AuroraBackground />

      <header className="relative z-10 w-full border-b border-border/40 bg-background/20 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <Logo />
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/60 px-3 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
              <span className="sr-only sm:hidden">Settings</span>
            </Link>
            <ThemeToggle variant="compact" />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div
        id="main-content"
        className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-16"
      >
        <div className="flex items-center gap-4 pt-2 sm:gap-5">
          {/* Initial avatar — gives the header weight without clutter. */}
          <span
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border/70 glass-strong text-base font-semibold text-foreground/80 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.6)] sm:h-12 sm:w-12"
          >
            {displayName.charAt(0).toUpperCase()}
          </span>

          <div className="flex min-w-0 flex-col gap-1">
            {/*
             * The account badge now states the ACTUAL account type. Previously
             * it rendered only for guests, so a real account looked
             * indistinguishable — and a wrongly-flagged one was told it was a
             * guest with no way to tell that the label was wrong.
             */}
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/60 bg-surface-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {isGuest ? (
                <User className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Mail className="h-3 w-3" aria-hidden="true" />
              )}
              {authMethodLabel(authMethod)}
            </span>
            <h1 className="text-gradient truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              Hi, {displayName}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Tap the orb and speak — Elara listens and replies in real time.
            </p>
          </div>
        </div>

        <div className="flex flex-1 py-10">
          {/*
            `m-auto` instead of `items-center`: auto margins collapse to zero
            when the console is taller than this space, so the card's top — and
            the sticky orb below it — stays reachable. A centered flex item
            would push its top out of scroll range on short screens.
          */}
          <div className="m-auto w-full max-w-xl">
            <VoiceConsole
              userId={user.id}
              memoryEnabled={settings?.memory_enabled ?? true}
              displayName={displayName}
            />
          </div>
        </div>
      </div>
    </div>
  );
}