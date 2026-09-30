import Link from "next/link";
import { AudioLines, ShieldCheck, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
import { Logo } from "@/components/brand/logo";
import { GlowOrb } from "@/components/ui/glow-orb";

interface ValuePoint {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * All three value points are shown at once (rather than rotating one at a
 * time) so the panel carries real weight instead of empty space.
 */
const VALUE_POINTS: ValuePoint[] = [
  {
    icon: AudioLines,
    title: "Real-time voice",
    body: "Speak naturally — Elara replies while you are still talking.",
  },
  {
    icon: ShieldCheck,
    title: "Private by default",
    body: "Row Level Security on every table. Your words stay yours.",
  },
  {
    icon: Sparkles,
    title: "Remembers the thread",
    body: "Continuity, without starting from scratch every time.",
  },
];

/** Waveform heights, mirroring the landing page's voice visual. */
const WAVE_BARS = [
  0.35, 0.65, 1, 0.5, 0.8, 0.45, 0.9, 0.4, 0.7, 0.55, 0.3, 0.6,
] as const;

const TRUST_CHIPS = ["No audio stored", "TLS in transit", "RLS enforced"] as const;

/**
 * Editorial brand panel shown beside the auth forms on large viewports.
 *
 * Server Component by design: every motion here is pure CSS (`animate-wave`)
 * or a decorative GlowOrb, so there is no client state and no hydration cost.
 */
export function AuthBrandPanel() {
  return (
    <aside className="relative hidden flex-1 overflow-hidden border-r border-border lg:flex lg:flex-col">
      {/* Decorative layers live in their own clipping wrapper so the content
          column below can scroll safely on short viewports. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <GlowOrb className="-left-32 -top-24 h-96 w-96" color="primary" delay={0} />
        <GlowOrb className="-bottom-24 -right-16 h-80 w-80" color="violet" delay={2} />
        <div className="absolute inset-0 grid-pattern opacity-60 [mask-image:radial-gradient(70%_60%_at_30%_20%,black,transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-between gap-10 overflow-y-auto p-10">
        {/* Brand + tagline */}
        <div className="flex flex-col gap-8">
          <Link
            href="/"
            aria-label="Elara — home"
            className="inline-flex w-fit rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Logo size="lg" />
          </Link>

          <div className="flex flex-col gap-4">
            <h2 className="text-gradient max-w-md text-3xl font-bold leading-tight tracking-tight">
              A voice that listens like a{" "}
              <span className="font-display italic text-primary-soft">friend</span>.
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Real-time, private voice conversations with Elara — no typing, no
              waiting, and nothing kept that you did not ask to keep.
            </p>
          </div>
        </div>

        {/* Value points */}
        <ul className="flex flex-col gap-3">
          {VALUE_POINTS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex items-start gap-4 rounded-2xl border border-border glass p-4"
            >
              <IconTile icon={<Icon className="h-5 w-5" aria-hidden="true" />} />
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* Voice visual + trust chips */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4 rounded-2xl border border-border glass px-5 py-4">
            <span aria-hidden="true" className="flex items-end gap-1">
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
            </span>
            <span className="text-xs text-muted-foreground">
              Listening in real time
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {TRUST_CHIPS.map((chip) => (
              <Badge key={chip}>{chip}</Badge>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
