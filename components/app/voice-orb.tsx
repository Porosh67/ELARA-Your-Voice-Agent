"use client";

import { motion } from "motion/react";
import { AlertCircle, AudioLines, Mic, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import type { VoiceStatus } from "@/lib/voice/types";

/**
 * The primary voice control: one large orb that is also the start/stop button.
 *
 * Each loop state has its own motion signature, built only from the design
 * system's primitives (`animate-pulse-ring`, `animate-wave`, theme tokens and
 * `motion` springs), so the orb reads as a single object wearing different
 * moods:
 *
 *   idle       — a slow breath, nothing else
 *   connecting — a comet of brand light circling the rim
 *   listening  — sonar rings expanding outward
 *   thinking   — a single quiet arc sweeping the rim
 *   speaking   — waveform bars with a slow comet behind them
 *   error      — still, with a warm red bloom
 *
 * Reduced motion strips every moving layer down to its static equivalent.
 */

/** Relative bar heights for the "speaking" waveform inside the core. */
const SPEAKING_BARS = [0.5, 0.85, 1, 0.62, 0.92, 0.55, 0.78] as const;

/** Indices of the sonar rings, so the stagger stays declarative. */
const SONAR_RINGS = [0, 1, 2] as const;

/** Rotational offsets (deg) of the comet's fading trail segments. */
const COMET_TRAIL = [0, 32, 64] as const;
/** Matching opacities — a bright head with a soft tail. */
const COMET_TAIL_OPACITY = [0.9, 0.4, 0.15] as const;

interface OrbVisual {
  Icon: LucideIcon;
  /** Ambient bloom behind the orb. */
  bloom: string;
  /** Border tint for the halo + core. */
  ring: string;
  /** Icon / arc colour — also drives the comet via `currentColor`. */
  tone: string;
  /** Expanding sonar rings — listening only. */
  sonar: boolean;
  /** Sweeping arc — thinking only. */
  sweep: boolean;
  /** Rotating comet of brand light along the rim — connecting and speaking. */
  comet: boolean;
  /** The core itself gently breathes. */
  breathes: boolean;
}

/** One visual per state, so all six states are covered by construction. */
const ORB_VISUALS: Record<VoiceStatus, OrbVisual> = {
  idle: {
    Icon: Mic,
    bloom: "bg-primary/10",
    ring: "border-border-strong",
    tone: "text-muted-foreground",
    sonar: false,
    sweep: false,
    comet: false,
    breathes: true,
  },
  connecting: {
    Icon: Mic,
    bloom: "bg-primary/20",
    ring: "border-primary/40",
    tone: "text-primary",
    sonar: false,
    sweep: false,
    comet: true,
    breathes: false,
  },
  listening: {
    Icon: Mic,
    bloom: "bg-primary/25",
    ring: "border-primary/50",
    tone: "text-primary",
    sonar: true,
    sweep: false,
    comet: false,
    breathes: true,
  },
  thinking: {
    Icon: Sparkles,
    bloom: "bg-amber-500/15",
    ring: "border-amber-500/40",
    tone: "text-amber-600 dark:text-amber-300",
    sonar: false,
    sweep: true,
    comet: false,
    breathes: false,
  },
  speaking: {
    Icon: AudioLines,
    bloom: "bg-emerald-500/15",
    ring: "border-emerald-500/40",
    tone: "text-emerald-600 dark:text-emerald-300",
    sonar: false,
    sweep: false,
    comet: true,
    breathes: true,
  },
  error: {
    Icon: AlertCircle,
    bloom: "bg-red-500/15",
    ring: "border-red-500/40",
    tone: "text-red-500 dark:text-red-300",
    sonar: false,
    sweep: false,
    comet: false,
    breathes: false,
  },
};


interface VoiceOrbProps {
  status: VoiceStatus;
  /** Whether a session is live — decides the accessible label. */
  isActive: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function VoiceOrb({
  status,
  isActive,
  onToggle,
  disabled = false,
}: VoiceOrbProps) {
  const prefersReducedMotion = useReducedMotion();
  const visual = ORB_VISUALS[status];
  const Icon = visual.Icon;
  const label = isActive ? "Stop the voice session" : "Start talking";
  const motionEnabled = !prefersReducedMotion && !disabled;

  // Moving layers collapse to their static equivalents when motion is reduced.
  const showComet = visual.comet && motionEnabled;
  const showSweep = visual.sweep && motionEnabled;

  return (
    <div className="relative grid h-44 w-44 place-items-center sm:h-52 sm:w-52">
      {/* Ambient bloom — the only large area of colour. */}
      <motion.span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-4 rounded-full blur-3xl transition-colors duration-700",
          visual.bloom,
        )}
        animate={
          motionEnabled
            ? { scale: [0.94, 1.06, 0.94], opacity: [0.55, 0.9, 0.55] }
            : undefined
        }
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Comet — a bright head with a fading tail, circling the rim. */}
      {showComet ? (
        <motion.span
          aria-hidden="true"
          className={cn("absolute inset-0", visual.tone)}
          animate={{ rotate: 360 }}
          transition={{
            duration: status === "speaking" ? 4.4 : 2.8,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          {COMET_TRAIL.map((offset, index) => (
            <span
              key={offset}
              aria-hidden="true"
              className={cn(
                "absolute inset-0 rounded-full border border-transparent border-t-current",
                status === "speaking" && "border-t-2",
              )}
              style={{
                transform: `rotate(${offset}deg)`,
                opacity: COMET_TAIL_OPACITY[index],
              }}
            />
          ))}
        </motion.span>
      ) : null}

      {/* Sonar rings — expanding while listening; a single calm ring without
          motion, so the reduced-motion fallback still reads as deliberate. */}
      {visual.sonar ? (
        motionEnabled ? (
          SONAR_RINGS.map((index) => (
            <span
              key={index}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 rounded-full border transition-colors duration-700",
                visual.ring,
                "animate-pulse-ring",
              )}
              style={{ animationDelay: `${index * 1.33}s` }}
            />
          ))
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-full border",
              visual.ring,
            )}
          />
        )
      ) : null}

      {/* Sweeping arc — thinking. `border-t-current` inherits the state tone. */}
      {showSweep ? (
        <motion.span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-2 rounded-full border border-transparent border-t-current",
            visual.tone,
          )}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        />
      ) : null}

      {/* Static halo. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-3 rounded-full border transition-colors duration-700",
          visual.ring,
        )}
      />


      {/* Core control. */}
      <motion.button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={label}
        aria-pressed={isActive}
        title={label}
        whileHover={motionEnabled ? { scale: 1.04 } : undefined}
        whileTap={motionEnabled ? { scale: 0.96 } : undefined}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
        className={cn(
          "relative z-10 grid h-24 w-24 place-items-center rounded-full sm:h-28 sm:w-28",
          "glass-strong border shadow-[0_18px_50px_-20px_rgba(0,0,0,0.7)]",
          "outline-none transition-colors duration-500",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          visual.ring,
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {/* Subtle top-lit gradient, for depth. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 rounded-full bg-gradient-to-b from-white/12 to-transparent dark:from-white/6"
        />

        {/* The breathing wrapper lives inside the button, so it never fights
            the hover/tap springs that also drive `scale`. */}
        <motion.span
          className="relative grid place-items-center"
          animate={
            motionEnabled && visual.breathes
              ? { scale: [1, 1.05, 1] }
              : undefined
          }
          transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut" }}
        >
          {status === "speaking" ? (
            <span
              aria-hidden="true"
              className={cn(
                "relative flex items-end gap-[3px] drop-shadow-[0_0_5px_var(--glow)]",
                visual.tone,
              )}
            >
              {SPEAKING_BARS.map((height, index) => (
                <span
                  key={index}
                  className={cn(
                    "w-[3px] origin-bottom rounded-full bg-current",
                    !prefersReducedMotion && "animate-wave",
                  )}
                  style={{
                    height: `${height * 26}px`,
                    animationDelay: `${index * 0.09}s`,
                    animationDuration: `${1 + (index % 3) * 0.16}s`,
                  }}
                />
              ))}
            </span>
          ) : (
            <Icon
              aria-hidden="true"
              className={cn(
                "relative h-9 w-9 transition-colors duration-500 sm:h-10 sm:w-10",
                visual.tone,
              )}
            />
          )}
        </motion.span>
      </motion.button>
    </div>
  );
}