"use client";

import { motion, type Variants } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EASE_OUT } from "@/components/ui/reveal";
import { GlowOrb } from "@/components/ui/glow-orb";
import { VoiceOrb } from "@/components/landing/voice-orb";

const MICRO_PROOFS = [
  "No data resale",
  "Encrypted in transit",
  "40+ languages",
] as const;

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.1 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE_OUT },
  },
};

interface HeroProps {
  /** Destination for the primary call to action (`/login` or `/app`). */
  ctaHref: string;
}

export function Hero({ ctaHref }: HeroProps) {
  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] items-center overflow-hidden px-6 pb-24 pt-16 sm:pt-24">
      <GlowOrb
        className="-left-40 top-0 h-[500px] w-[500px]"
        color="primary"
        delay={0}
      />
      <GlowOrb
        className="-right-32 top-1/4 h-[420px] w-[420px]"
        color="violet"
        delay={2}
      />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
        <div className="flex flex-col items-center gap-8 text-center lg:items-start lg:text-left">
          <motion.div
            className="flex flex-col items-center gap-7 lg:items-start"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={itemVariants}>
              <Badge pulse>Private by design · Real-time voice</Badge>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="text-gradient max-w-2xl text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
            >
              A voice that listens like a{" "}
              <span className="font-display italic text-primary-soft">
                friend
              </span>
              .
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="max-w-lg text-lg leading-relaxed text-muted-foreground"
            >
              Elara speaks with you in real time — no typing, no waiting.
              Warm, attentive, and private by default.
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="flex flex-col items-center gap-3 sm:flex-row"
            >
              <ButtonLink href={ctaHref} size="lg">
                Start Talking
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="#how-it-works" variant="secondary" size="lg">
                See how it works
              </ButtonLink>
            </motion.div>

            <motion.ul
              variants={itemVariants}
              className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground lg:justify-start"
            >
              {MICRO_PROOFS.map((proof) => (
                <li key={proof} className="inline-flex items-center gap-1.5">
                  <Check
                    className="h-3.5 w-3.5 text-primary-soft"
                    aria-hidden="true"
                  />
                  {proof}
                </li>
              ))}
            </motion.ul>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.25 }}
        >
          <VoiceOrb />
        </motion.div>
      </div>
    </section>
  );
}
