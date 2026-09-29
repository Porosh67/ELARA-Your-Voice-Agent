"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NAV_LINKS } from "@/components/layout/nav-links";
import { EASE_OUT } from "@/components/ui/reveal";
import { ButtonLink } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";

interface MobileNavProps {
  isAuthenticated: boolean;
}

const HAMBURGER_CLASSES = [
  "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border",
  "text-muted-foreground transition-colors duration-200",
  "hover:border-border-strong hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
].join(" ");

/** Full-screen sheet navigation for small viewports, with focus + scroll hygiene. */
export function MobileNav({ isAuthenticated }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
        className={HAMBURGER_CLASSES}
      >
        {open ? (
          <X className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Menu className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />

            <motion.div
              key="panel"
              id="mobile-nav"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="fixed inset-x-0 top-16 z-50 md:hidden"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              <div className="mx-4 overflow-hidden rounded-3xl border border-border glass-strong p-5 shadow-2xl">
                <nav
                  aria-label="Mobile"
                  className="flex flex-col gap-1"
                >
                  {NAV_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="rounded-2xl px-4 py-3 text-sm font-medium text-foreground/90 transition-colors duration-200 hover:bg-card hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
                  <ThemeToggle />

                  {isAuthenticated ? (
                    <ButtonLink
                      href="/app"
                      size="sm"
                      onClick={() => setOpen(false)}
                    >
                      Open Elara
                    </ButtonLink>
                  ) : (
                    <div className="flex gap-2">
                      <ButtonLink
                        href="/login"
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpen(false)}
                      >
                        Log in
                      </ButtonLink>
                      <ButtonLink
                        href="/signup"
                        size="sm"
                        onClick={() => setOpen(false)}
                      >
                        Sign up
                      </ButtonLink>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
