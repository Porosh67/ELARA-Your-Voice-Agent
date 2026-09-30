import { cn } from "@/lib/utils";

/**
 * THE ELARA MARK — a stylised "E" assembled from voice-waveform bars.
 *
 * ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
 *
 * A capital E is three horizontal strokes joined by one vertical stem, and a
 * voice waveform is a row of vertical bars of varying height. Fusing the two —
 * three horizontal bars crossed by a stem, with the middle bar broken into a
 * waveform — gives a mark that is unmistakably an E at a glance AND unmistakably
 * audio at a glance, which is exactly what the product is: a voice assistant.
 *
 * ── BUILT TO SURVIVE ITS OWN SIZES ──────────────────────────────────────────
 *
 * The mark is drawn on a 32x32 grid with a 2.5 unit stroke and rounded caps.
 *
 *  - AT 16px (favicon, tab): the three bars keep a clear, uneven silhouette and
 *    the colour carries it. Detail is deliberately absent rather than shrunk —
 *    a fine waveform at 16px turns to mud, so the small sizes drop the ticks
 *    and keep the rhythm.
 *  - AT 200px (splash, print): the waveform ticks appear, the stem's rounded
 *    caps read as deliberate rather than as a rendering artefact, and the
 *    negative space between the bars stays open.
 *
 * ── NO EXTERNAL ASSETS ──────────────────────────────────────────────────────
 *
 * Every path is hand-written geometry on that grid. No font, no image, no
 * gradient filter, no network fetch. It inherits colour from the theme, so it is
 * correct in light and dark without a second asset.
 */

interface LogoMarkProps {
  className?: string;
  /**
   * Renders the simplified variant. Set by callers that know they are below
   * ~24px rather than trusting the browser to guess.
   */
  simplified?: boolean;
}

/**
 * The bare mark. Sized by the caller through `className` (e.g. `h-7 w-7`).
 *
 * `aria-hidden` because it carries no information the surrounding link does not
 * already provide in its accessible name — a decorative graphic must not be
 * announced twice.
 */
export function LogoMark({ className, simplified = false }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {/*
        THE STEM — the vertical spine of the E, and the axis the waveform
        crosses. Drawn as a rounded line so it reads as friendly rather than
        mechanical, which suits a companion rather than a terminal.
      */}
      <path
        d="M8 5.5v21"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.95"
      />

      {/*
        TOP BAR — the longest, and set slightly proud on the right, so the
        silhouette is asymmetric the way a real waveform is.
      */}
      <path
        d="M8 6.5h13.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/*
        MIDDLE BAR — the stroke that makes the E read, and the one drawn as the
        waveform. Three bars of clearly different heights with a gap between
        them: that rhythm IS the recognition cue, so the gaps are as load-bearing
        as the bars.
      */}
      {simplified ? (
        <path
          d="M8 16h11.5"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      ) : (
        <g>
          <path d="M8 16h2.6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M13.4 16h2.2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.75" />
          <path d="M18.2 16h2.2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
        </g>
      )}

      {/*
        BOTTOM BAR — longest again, mirroring the top, which closes the E.
      */}
      <path
        d="M8 25.5h13.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/*
        THE TICKS — four small marks stepping up the right side, the visual
        shorthand for a live level meter. They sit OUTSIDE the E's silhouette so
        they never muddy the letter, and are omitted entirely in the simplified
        variant where they would be sub-pixel.
      */}
      {simplified ? null : (
        <g
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          opacity="0.5"
        >
          <path d="M25.4 8.5v3" />
          <path d="M25.4 14.5v3" />
          <path d="M25.4 20.5v3" />
        </g>
      )}
    </svg>
  );
}

interface LogoProps {
  className?: string;
  /** Renders only the mark (no wordmark). */
  markOnly?: boolean;
  size?: "sm" | "md" | "lg";
}

const markSizes = {
  sm: "h-6 w-6",
  md: "h-7 w-7",
  lg: "h-9 w-9",
} as const;

const textSizes = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
} as const;

/**
 * The mark with the "Elara AI" wordmark beside it.
 *
 * The accessible name comes from the wrapping link, so both parts stay
 * decorative (`aria-hidden` on the mark, and the wordmark is real text that
 * reads correctly with styles off).
 */
export function Logo({ className, markOnly = false, size = "md" }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* `sm` is the size a 16px-tall mark would be used at, so it gets the
          simplified variant rather than risking a muddy render. */}
      <LogoMark className={markSizes[size]} simplified={size === "sm"} />

      {markOnly ? null : (
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            textSizes[size],
          )}
        >
          Elara AI
        </span>
      )}
    </span>
  );
}
