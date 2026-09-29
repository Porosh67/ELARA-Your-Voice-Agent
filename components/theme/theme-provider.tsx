"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Global client providers for the Elara design system.
 *
 * - `next-themes` drives Dark / Light / System theming with no flash of the
 *   wrong theme (it injects a pre-paint script and writes `.dark` on <html>).
 * - `MotionConfig reducedMotion="user"` makes every Motion animation in the app
 *   respect the operating system's `prefers-reduced-motion` setting.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  );
}
