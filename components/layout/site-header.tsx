import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { HeaderShell } from "@/components/layout/header-shell";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NAV_LINKS } from "@/components/layout/nav-links";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ButtonLink } from "@/components/ui/button";

/**
 * Sticky, auth-aware site header.
 *
 * Reading the session makes the landing page render dynamically, which buys
 * the right call to action for signed-in users ("Open Elara") instead of a
 * misleading "Log in".
 */
export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);

  return (
    <HeaderShell>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          aria-label="Elara — home"
          className="shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group relative rounded-full px-3.5 py-2 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              {link.label}
              <span
                aria-hidden="true"
                className="absolute inset-x-3.5 -bottom-0.5 h-px scale-x-0 bg-gradient-to-r from-transparent via-primary to-transparent transition-transform duration-300 group-hover:scale-x-100"
              />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />

          {isAuthenticated ? (
            <ButtonLink href="/app" size="sm">
              Open Elara
            </ButtonLink>
          ) : (
            <>
              <ButtonLink
                href="/login"
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
              >
                Log in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Get started
              </ButtonLink>
            </>
          )}

          <MobileNav isAuthenticated={isAuthenticated} />
        </div>
      </div>
    </HeaderShell>
  );
}
