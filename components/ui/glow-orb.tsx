"use client";

import { motion } from "motion/react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";

type GlowColor = "primary" | "soft" | "violet" | "fuchsia";

const colorMap: Record<GlowColor, string> = {
  primary: "bg-primary/20",
  soft: "bg-primary-soft/10",
  violet: "bg-violet-500/15",
  fuchsia: "bg-fuchsia-500/12",
};

interface GlowOrbProps {
  className?: string;
  color?: GlowColor;
  /** Animation start offset in seconds. */
  delay?: number;
  /** Peak opacity, 0–1. */
  intensity?: number;
}

/**
 * Soft, blurred ambient light. Decorative only.
 * Static when the user prefers reduced motion.
 */
export function GlowOrb({
  className,
  color = "primary",
  delay = 0,
  intensity = 0.6,
}: GlowOrbProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-full blur-[120px] will-change-transform",
        colorMap[color],
        className,
      )}
      animate={
        prefersReducedMotion
          ? undefined
          : {
              scale: [1, 1.15, 1],
              opacity: [intensity * 0.6, intensity, intensity * 0.6],
            }
      }
      transition={
        prefersReducedMotion
          ? undefined
          : { duration: 9, repeat: Infinity, delay, ease: "easeInOut" }
      }
    />
  );
}
