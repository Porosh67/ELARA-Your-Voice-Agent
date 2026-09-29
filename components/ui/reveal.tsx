"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared signature easing curve. */
export const EASE_OUT = [0.25, 0.46, 0.45, 0.94] as const;

interface RevealProps {
  children: ReactNode;
  delay?: number;
  /** Initial vertical offset in px. */
  y?: number;
  className?: string;
}

/**
 * Scroll-triggered fade-up. Fires once, 80px before the element enters the
 * viewport. Reduced motion is handled globally by <MotionConfig />.
 */
export function Reveal({ children, delay = 0, y = 24, className }: RevealProps) {
  return (
    <motion.div
      className={cn(className)}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}
