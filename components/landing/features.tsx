import { AudioLines, Globe2, HeartHandshake, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";
import { Reveal } from "@/components/ui/reveal";
import { Section } from "@/components/ui/section";
import { SpotlightCard } from "@/components/ui/spotlight-card";

type FeatureVisual =
  | { kind: "waveform" }
  | { kind: "chips"; values: readonly string[] }
  | { kind: "exchange"; user: string; reply: string };

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  visual: FeatureVisual;
  /** Columns spanned in the bento grid. */
  span?: 1 | 2;
}

const LANGUAGES = [
  "EN",
  "ES",
  "FR",
  "DE",
  "PT",
  "HI",
  "AR",
  "JA",
  "中文",
] as const;

const WAVEFORM_BARS = [0.3, 0.6, 0.9, 0.45, 0.75, 1, 0.5, 0.85, 0.4, 0.65, 0.3];

const FEATURES: Feature[] = [
  {
    icon: AudioLines,
    title: "Real-time voice",
    body: "Streamed speech in, streamed speech out — Elara responds while you are still talking, with no awkward pauses to break the flow.",
    visual: { kind: "waveform" },
    span: 2,
  },
  {
    icon: ShieldCheck,
    title: "Secure by design",
    body: "Row Level Security on every table. Your conversations are scoped to you — and only you.",
    visual: { kind: "chips", values: ["RLS enforced", "TLS in transit"] },
  },
  {
    icon: Globe2,
    title: "Multi-language",
    body: "Switch languages mid-sentence. Elara keeps up — and keeps its warmth.",
    visual: { kind: "chips", values: LANGUAGES },
  },
  {
    icon: HeartHandshake,
    title: "Friend-like AI",
    body: "Not an assistant with a manual. Someone who notices how your day is going.",
    visual: {
      kind: "exchange",
      user: "Rough day.",
      reply: "Tell me everything — I am listening.",
    },
    span: 2,
  },
];

const SPAN_CLASSES = {
  1: "",
  2: "md:col-span-2",
} as const;

function FeatureVisual({ visual }: { visual: FeatureVisual }) {
  if (visual.kind === "waveform") {
    return (
      <div
        aria-hidden="true"
        className="mt-6 flex items-end gap-1.5 rounded-2xl border border-border bg-surface-muted/40 px-5 py-4"
      >
        {WAVEFORM_BARS.map((height, index) => (
          <span
            key={index}
            className="w-1.5 origin-center animate-wave rounded-full bg-gradient-to-b from-primary-soft to-primary/40"
            style={{
              height: `${height * 34}px`,
              animationDelay: `${index * 0.12}s`,
              animationDuration: `${1.4 + (index % 3) * 0.2}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (visual.kind === "chips") {
    return (
      <div className="mt-6 flex flex-wrap gap-1.5">
        {visual.values.map((value) => (
          <span
            key={value}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
          >
            {value}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      <div className="max-w-xs rounded-2xl rounded-bl-md border border-border bg-surface-muted/40 px-4 py-2.5 text-sm text-foreground/90">
        {visual.user}
      </div>
      <div className="max-w-xs rounded-2xl rounded-br-md border border-primary/25 bg-primary/10 px-4 py-2.5 text-sm text-foreground">
        {visual.reply}
      </div>
    </div>
  );
}

/** Four capabilities laid out as a bento grid with hover spotlights. */
export function Features() {
  return (
    <Section
      id="features"
      eyebrow="What makes Elara different"
      title={
        <>
          Built to feel like a{" "}
          <span className="font-display italic text-primary-soft">person</span>,
          engineered like a vault.
        </>
      }
      subtitle="Everything below ships in the product today — not on a roadmap."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {FEATURES.map((feature, index) => (
          <Reveal
            key={feature.title}
            delay={index * 0.08}
            className={SPAN_CLASSES[feature.span ?? 1]}
          >
            <SpotlightCard className="h-full p-7">
              <IconTile
                icon={<feature.icon className="h-5 w-5" aria-hidden="true" />}
              />
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {feature.body}
              </p>
              <FeatureVisual visual={feature.visual} />
            </SpotlightCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
