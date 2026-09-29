"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type ThemeValue = "light" | "system" | "dark";

const THEME_VALUES: ThemeValue[] = ["light", "system", "dark"];

const THEME_ICONS: Record<ThemeValue, typeof Sun> = {
  light: Sun,
  system: Monitor,
  dark: Moon,
};

const emptySubscribe = () => () => {};

/**
 * `true` after hydration, `false` during SSR and the very first client render.
 * Implemented with `useSyncExternalStore` (rather than setState-in-effect) so
 * it is hydration-safe and lint-clean.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

interface ThemeToggleProps {
  /** `segmented` renders a 3-way switch; `compact` a single icon button. */
  variant?: "segmented" | "compact";
  className?: string;
}

/**
 * Dark / Light / System theme switch.
 *
 * Renders a disabled, theme-agnostic placeholder until after hydration so the
 * server HTML and the first client render always match (no hydration warning),
 * then springs the active pill into place.
 */
export function ThemeToggle({
  variant = "segmented",
  className,
}: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const activeTheme: ThemeValue | null = mounted
    ? (THEME_VALUES.includes(theme as ThemeValue)
        ? (theme as ThemeValue)
        : "system")
    : null;

  if (variant === "compact") {
    const currentIndex = activeTheme ? THEME_VALUES.indexOf(activeTheme) : 2;
    const nextTheme =
      THEME_VALUES[(currentIndex + 1) % THEME_VALUES.length] ?? "system";
    const ActiveIcon = activeTheme ? THEME_ICONS[activeTheme] : Monitor;

    return (
      <button
        type="button"
        aria-label={
          activeTheme
            ? `Current theme: ${activeTheme}. Switch to ${nextTheme}`
            : "Switch color theme"
        }
        title="Change theme"
        disabled={!mounted}
        onClick={() => setTheme(nextTheme)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border",
          "text-muted-foreground transition-colors duration-200",
          "hover:border-border-strong hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <ActiveIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border",
        "bg-surface-muted/70 p-1 backdrop-blur-md",
        className,
      )}
    >
      {THEME_VALUES.map((value) => {
        const Icon = THEME_ICONS[value];
        const isActive = activeTheme === value;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${value} theme`}
            title={`${value} theme`}
            disabled={!mounted}
            onClick={() => setTheme(value)}
            className={cn(
              "relative inline-flex h-7 w-7 items-center justify-center rounded-full",
              "transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {isActive ? (
              <motion.span
                layoutId="theme-toggle-pill"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="absolute inset-0 rounded-full border border-border bg-surface shadow-sm"
              />
            ) : null}
            <Icon className="relative z-10 h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
