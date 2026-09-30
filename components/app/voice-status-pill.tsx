"use client";

import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import type { VoiceStatus } from "@/lib/voice/types";

/**
 * Live status indicator for the voice loop.
 *
 * Deliberately quiet: a single 6px dot with a soft glow, plus a small-caps
 * label that crossfades between states. The state never shouts — the orb
 * carries the emphasis.
 *
 * `role="status"` + `aria-live="polite"` keeps screen readers informed of every
 * transition, which matters because the state changes without any user action.
 *
 * Memoized: the console re-renders on every transcript turn, and this component
 * only needs to move when `status` (or `className`) actually changes.
 */

interface StatusVisual {
  label: string;
  /** Dot colour — the only saturated element in the whole indicator. */
  dot: string;
  /** Soft glow behind the dot, drawn from the theme's bloom token. */
  halo: string;
  /** Label colour. Muted for calm states, saturated only on error. */
  tone: string;
  /** Emits a slow halo pulse. */
  animated: boolean;
}

/** One visual per state, so all eight states are covered by construction. */
const STATUS_VISUALS: Record<VoiceStatus, StatusVisual> = {
  idle: {
    label: "Ready",
    dot: "bg-muted-foreground/45",
    halo: "",
    tone: "text-muted-foreground/60",
    animated: false,
  },
  connecting: {
    label: "Connecting",
    dot: "bg-primary/70",
    halo: "shadow-[0_0_10px_2px_var(--glow)]",
    tone: "text-muted-foreground/80",
    animated: true,
  },
  listening: {
    label: "Listening",
    dot: "bg-primary",
    halo: "shadow-[0_0_12px_2px_var(--glow)]",
    tone: "text-foreground/75",
    animated: true,
  },
  thinking: {
    label: "Thinking",
    dot: "bg-amber-400",
    halo: "shadow-[0_0_12px_2px_var(--glow)]",
    tone: "text-foreground/75",
    animated: true,
  },
  searching: {
    label: "Searching",
    dot: "bg-amber-400",
    halo: "shadow-[0_0_12px_2px_var(--glow)]",
    tone: "text-foreground/75",
    animated: true,
  },
  "search-found": {
    label: "Live results",
    dot: "bg-emerald-400",
    halo: "shadow-[0_0_12px_2px_var(--glow)]",
    tone: "text-foreground/75",
    animated: true,
  },
  speaking: {
    label: "Speaking",
    dot: "bg-emerald-400",
    halo: "shadow-[0_0_12px_2px_var(--glow)]",
    tone: "text-foreground/75",
    animated: true,
  },
  error: {
    label: "Error",
    dot: "bg-red-500",
    halo: "",
    tone: "text-red-500 dark:text-red-300",
    animated: false,
  },
};

interface VoiceStatusPillProps {
  status: VoiceStatus;
  className?: string;
}

function VoiceStatusPillComponent({ status, className }: VoiceStatusPillProps) {
  const prefersReducedMotion = useReducedMotion();
  const { label, dot, halo, tone, animated } = STATUS_VISUALS[status];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Voice status: ${label}`}
      className={cn("inline-flex select-none items-center gap-2.5", className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500",
          dot,
          halo,
        )}
      >
        {animated && !prefersReducedMotion ? (
          <motion.span
            className={cn("absolute inset-0 rounded-full", dot)}
            animate={{ scale: [1, 2.6], opacity: [0.6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
        ) : null}
      </span>

      {/* Crossfade the label so state changes feel fluid, never jumpy. */}
      <span className="relative inline-flex h-4 items-center overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={label}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "absolute inset-x-0 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.18em] transition-colors duration-500",
              tone,
            )}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

/** Skips re-renders that do not change the voice status itself. */
export const VoiceStatusPill = memo(VoiceStatusPillComponent);

