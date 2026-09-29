"use client";

import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";

interface StatProps {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** Count-up duration in ms. */
  duration?: number;
  className?: string;
}

/**
 * Proof metric that counts up the first time it scrolls into view.
 * Skips the animation entirely (renders the final value) when the user prefers
 * reduced motion.
 */
export function Stat({
  value,
  label,
  prefix,
  suffix,
  decimals = 0,
  duration = 1400,
  className,
}: StatProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const prefersReducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || prefersReducedMotion) {
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, prefersReducedMotion, value, duration]);

  const shown = inView && !prefersReducedMotion ? display : value;
  const formatted = shown.toFixed(decimals);

  return (
    <div
      ref={ref}
      className={cn("flex flex-col items-center gap-1.5 text-center", className)}
    >
      <span className="text-gradient text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
        {prefix}
        {formatted}
        {suffix}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
