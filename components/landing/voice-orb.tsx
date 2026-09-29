"use client";

import { motion } from "motion/react";
import { Mic, Sparkles } from "lucide-react";
import { EASE_OUT } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

const WAVE_BARS = [
  0.45, 0.8, 1, 0.6, 0.35, 0.75, 0.5, 0.9, 0.4, 0.65, 0.3, 0.85, 0.5, 0.7, 0.35,
  0.6,
];

/**
 * The hero centerpiece: a breathing core wrapped in concentric pulse rings,
 * a live-looking waveform chip and a floating status pill.
 *
 * Pure CSS/SVG + Motion — a mockup of the real-time voice interface (the voice
 * brain itself is intentionally not implemented in this phase).
 */
export function VoiceOrb({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative mx-auto flex aspect-square w-full max-w-[420px] items-center justify-center",
        className,
      )}
    >
      {/* Concentric pulse rings */}
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="absolute inset-0 animate-pulse-ring rounded-full border border-primary/25"
          style={{ animationDelay: `${index * 1.3}s` }}
        />
      ))}

      {/* Core */}
      <div className="relative flex h-[62%] w-[62%] items-center justify-center">
        <span className="absolute inset-0 animate-breathe rounded-full bg-[radial-gradient(circle_at_50%_35%,var(--aurora-1),transparent_70%)] blur-2xl" />
        <span className="absolute inset-0 rounded-full border border-border glass" />
        <span className="absolute inset-[14%] rounded-full border border-border bg-surface-muted/40" />
        <Mic className="relative z-10 h-8 w-8 text-primary" />
      </div>

      {/* Waveform chip */}
      <motion.div
        className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-end gap-1 rounded-full border border-border glass-strong px-4 py-3 shadow-xl"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.5 }}
      >
        {WAVE_BARS.map((height, index) => (
          <span
            key={index}
            className="w-1 origin-center animate-wave rounded-full bg-primary/70"
            style={{
              height: `${height * 22}px`,
              animationDelay: `${index * 0.09}s`,
              animationDuration: `${1.2 + (index % 4) * 0.15}s`,
            }}
          />
        ))}
      </motion.div>

      {/* Floating status pill */}
      <motion.div
        className="absolute right-0 top-[6%] flex animate-float items-center gap-2 rounded-full border border-border glass px-3.5 py-2 text-xs text-muted-foreground shadow-lg"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.8 }}
      >
        <Sparkles className="h-3.5 w-3.5 text-primary-soft" aria-hidden="true" />
        Listening in real time
      </motion.div>
    </div>
  );
}
