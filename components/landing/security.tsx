import { Check, Lock, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GlowOrb } from "@/components/ui/glow-orb";
import { Reveal } from "@/components/ui/reveal";
import { Section } from "@/components/ui/section";
import { SpotlightCard } from "@/components/ui/spotlight-card";

const PROMISES = [
  "Row Level Security on every table — your data is scoped to you alone",
  "Sessions isolated per user and encrypted in transit",
  "Never trained on your conversations",
  "Anonymous guest mode — try it with zero personal data",
  "Delete everything, anytime, in one tap",
] as const;

const VAULT_BADGES = [
  "RLS enforced",
  "TLS in transit",
  "No training",
  "Guest-first",
] as const;

const VAULT_ROWS = [
  { width: "92%", delay: 0 },
  { width: "78%", delay: 0.1 },
  { width: "64%", delay: 0.2 },
  { width: "48%", delay: 0.3 },
] as const;

/** Privacy section: the promises on the left, a "vault" visual on the right. */
export function Security() {
  return (
    <Section
      id="security"
      align="left"
      eyebrow="Security"
      title={
        <>
          Privacy isn&apos;t a feature. It&apos;s the{" "}
          <span className="font-display italic text-primary-soft">
            foundation
          </span>
          .
        </>
      }
      subtitle="A voice friend is only trustworthy if you never have to think about where your words end up."
    >
      <div className="relative grid gap-14 lg:grid-cols-2 lg:items-center">
        <GlowOrb
          className="-right-24 top-0 h-80 w-80"
          color="primary"
          delay={1}
        />

        <Reveal>
          <ul className="flex flex-col gap-4">
            {PROMISES.map((promise) => (
              <li key={promise} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                  <Check
                    className="h-3 w-3 text-primary-soft"
                    aria-hidden="true"
                  />
                </span>
                <span className="text-sm leading-relaxed text-foreground/85">
                  {promise}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.15}>
          <SpotlightCard className="p-6">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <Lock className="h-4 w-4 text-primary-soft" aria-hidden="true" />
                Elara vault
              </span>
              <span className="text-xs text-muted-foreground">Encrypted</span>
            </div>

            <ul className="mt-4 flex flex-col gap-3">
              {VAULT_ROWS.map((row) => (
                <li
                  key={row.width}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-surface-muted/40 px-4 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full bg-primary/60"
                  />
                  <span
                    aria-hidden="true"
                    className="h-2.5 rounded-full bg-gradient-to-r from-foreground/15 to-foreground/5"
                    style={{ width: row.width }}
                  />
                  <ShieldCheck
                    className="ml-auto h-4 w-4 shrink-0 text-primary-soft/70"
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ul>

            <div className="mt-5 flex flex-wrap gap-2">
              {VAULT_BADGES.map((badge) => (
                <Badge key={badge}>{badge}</Badge>
              ))}
            </div>
          </SpotlightCard>
        </Reveal>
      </div>
    </Section>
  );
}
