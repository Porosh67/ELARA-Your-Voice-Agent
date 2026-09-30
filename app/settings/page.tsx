import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ensureUserRows } from "@/lib/data/user-data";
import { Logo } from "@/components/brand/logo";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SettingsForm } from "@/components/settings/settings-form";
import type { UserSettings } from "@/types/database";

/**
 * /settings — profile, preferences, legal pages and account deletion.
 *
 * The session is re-checked server-side rather than trusted from `proxy.ts`,
 * which is only a convenience layer. `ensureUserRows` then guarantees the rows
 * this page edits actually exist: someone who deletes their settings row by hand
 * in the table editor should get working settings back, not a screen whose every
 * change silently fails to save.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const { profile, settings } = await ensureUserRows(user);

  const isGuest = profile?.is_guest ?? Boolean(user.is_anonymous);

  return (
    <div className="relative flex min-h-screen flex-1 flex-col">
      <AuroraBackground />

      <header className="relative z-10 w-full border-b border-border/40 bg-background/20 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-6 px-6 py-5">
          <Logo />
          <div className="flex items-center gap-3">
            <ThemeToggle variant="compact" />
            <Link
              href="/app"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/60 px-3 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Elara
            </Link>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-6 pb-20 pt-10"
      >
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-gradient text-3xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Your account, your preferences, and what happens to your data.
          </p>
        </div>

        <SettingsForm
          isGuest={isGuest}
          initialProfile={{
            id: profile?.id ?? user.id,
            email: profile?.email ?? user.email ?? null,
            username: profile?.username ?? null,
            display_name: profile?.display_name ?? null,
            is_guest: isGuest,
          }}
          initialSettings={{
            preferred_language:
              (settings as UserSettings | null)?.preferred_language ?? "en",
            tts_voice: (settings as UserSettings | null)?.tts_voice ?? null,
            tts_rate: (settings as UserSettings | null)?.tts_rate ?? 1,
            theme: (settings as UserSettings | null)?.theme ?? "dark",
            memory_enabled: (settings as UserSettings | null)?.memory_enabled ?? true,
          }}
        />
      </main>
    </div>
  );
}
