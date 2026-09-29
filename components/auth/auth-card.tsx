"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "@/components/ui/reveal";
import { GlowOrb } from "@/components/ui/glow-orb";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Frosted auth card: glass fill, gradient hairline sheen, and a soft brand
 * bloom bleeding past its edges.
 */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="relative w-full max-w-md">
      <GlowOrb
        className="-left-24 -top-20 h-64 w-64"
        color="primary"
        intensity={0.5}
      />
      <GlowOrb
        className="-bottom-20 -right-16 h-56 w-56"
        color="violet"
        delay={2}
        intensity={0.4}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        className="relative overflow-hidden rounded-3xl border border-border glass p-8 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)] hairline-sheen sm:p-10"
      >
        <header className="mb-8 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-tight">
            {title}
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </header>

        {children}
      </motion.div>

      {footer ? (
        <div className="mt-6 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
