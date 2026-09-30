import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * Pill-shaped "Back to home" control. Lives in the top bar at every
 * breakpoint so there is always an obvious way out of the auth flow.
 */
const BACK_LINK_CLASSES = cn(
  "group inline-flex items-center gap-2 rounded-full border border-border glass px-3.5 py-2",
  "text-sm font-medium text-muted-foreground",
  "transition-colors duration-200 hover:border-border-strong hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

/**
 * Split auth layout: editorial brand panel on the left, form column on the
 * right. Collapses to a single column with a compact brand mark on mobile.
 *
 * The top bar always carries a "Back to home" affordance (plus the theme
 * toggle) so a visitor is never trapped inside the auth flow.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-full">
      <AuthBrandPanel />

      <main
        id="main-content"
        className="relative flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-4 p-5 lg:p-8">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              aria-label="Elara — home"
              className="inline-flex rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <Logo markOnly />
            </Link>

            <Link href="/" className={BACK_LINK_CLASSES}>
              <ArrowLeft
                className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Back to home</span>
              <span className="sm:hidden">Back</span>
            </Link>
          </div>

          <ThemeToggle variant="compact" />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-16">
          {children}
        </div>
      </main>
    </div>
  );
}
