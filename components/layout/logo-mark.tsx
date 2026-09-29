import { cn } from "@/lib/utils";

interface LogoMarkProps {
  className?: string;
}

/**
 * The Elara mark: a crescent moon with a four-point sparkle.
 *
 * Elara is a moon of Jupiter — hence the crescent — and the sparkle is the
 * small bright companion beside it: the visual echo of a voice companion who
 * is present but never loud. Deliberately NOT a letter tile: it should read as
 * a considered brand mark at 16 px in the header and at 128 px as the app
 * icon, in both light and dark themes, with no background plate.
 *
 * Each instance carries its own gradient <defs> with fixed ids (identical
 * duplicates across instances are harmless) so the component stays
 * self-contained — no wiring needed in the root layout.
 */
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient
          id="elara-mark-moon"
          x1="6"
          y1="26"
          x2="26"
          y2="6"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6366F1" />
          <stop offset="0.55" stopColor="#818CF8" />
          <stop offset="1" stopColor="#A5B4FC" />
        </linearGradient>
      </defs>

      {/* Crescent — a disc with an offset arc carved from it. */}
      <path
        d="M18 6.5A9.5 9.5 0 0 0 18 25.5A12 12 0 0 1 18 6.5Z"
        fill="url(#elara-mark-moon)"
      />
      {/* Four-point sparkle in the open sky beside the crescent. */}
      <path
        d="M24.2 6.4c.32 1.72.9 2.3 2.62 2.62-1.72.32-2.3.9-2.62 2.62-.32-1.72-.9-2.3-2.62-2.62 1.72-.32 2.3-.9 2.62-2.62Z"
        fill="url(#elara-mark-moon)"
      />
    </svg>
  );
}
