import { redirect } from "next/navigation";
import { User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { VoiceConsole } from "@/components/app/voice-console";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  const isGuest = profile?.is_guest ?? Boolean(user.is_anonymous);
  const displayName =
    profile?.display_name ?? user.email?.split("@")[0] ?? "Friend";

  return (
    <div className="relative flex min-h-screen flex-1 flex-col">
      <AuroraBackground />

      <header className="relative z-10 w-full border-b border-border/40 bg-background/20 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <Logo />
          <div className="flex items-center gap-3">
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
            {isGuest ? (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/60 bg-surface-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                <User className="h-3 w-3" aria-hidden="true" />
                Guest session
              </span>
            ) : null}
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
            <VoiceConsole />
          </div>
        </div>
      </div>
    </div>
  );
}