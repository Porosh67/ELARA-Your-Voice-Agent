"use client";

import { motion } from "motion/react";
import { Mic, Sparkles, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";
import { Reveal, EASE_OUT } from "@/components/ui/reveal";
import { Section } from "@/components/ui/section";

interface Step {
  number: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    number: "01",
    icon: UserRound,
    title: "Create your space",
    body: "Sign up in seconds, or continue as a guest — no credit card, ever.",
  },
  {
    number: "02",
    icon: Mic,
    title: "Press to talk",
    body: "Hold the button and speak naturally. Elara streams back in real time.",
  },
  {
    number: "03",
    icon: Sparkles,
    title: "Just talk",
    body: "Elara follows the thread of the conversation and answers like a friend would.",
  },
];

/** Three steps with a connector line that draws itself on scroll. */
export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title={
        <>
          Talking to Elara takes{" "}
          <span className="font-display italic text-primary-soft">seconds</span>{" "}
          to start.
        </>
      }
      subtitle="No setup, no configuration, no learning curve."
    >
      <div className="relative">
        {/* Connector line */}
        <div
          aria-hidden="true"
          className="absolute left-[16.6%] right-[16.6%] top-[3.25rem] hidden h-px md:block"
        >
          <motion.span
            className="absolute inset-0 origin-left bg-gradient-to-r from-primary/60 via-primary/30 to-primary/10"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.25 }}
          />
        </div>

        <div className="relative grid gap-5 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <Reveal key={step.number} delay={index * 0.12}>
              <article className="flex h-full flex-col gap-4 rounded-3xl border border-border glass p-7 hairline-sheen">
                <div className="flex items-start justify-between">
                  <IconTile
                    icon={<step.icon className="h-5 w-5" aria-hidden="true" />}
                  />
                  <span className="font-display text-4xl leading-none text-foreground/15">
                    {step.number}
                  </span>
                </div>

                <h3 className="text-lg font-semibold tracking-tight text-foreground">
                  {step.title}
                </h3>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
