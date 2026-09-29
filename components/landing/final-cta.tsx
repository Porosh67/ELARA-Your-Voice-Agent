import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { GlowOrb } from "@/components/ui/glow-orb";
import { Reveal } from "@/components/ui/reveal";

interface FinalCtaProps {
  /** Destination for the primary call to action (`/login` or `/app`). */
  ctaHref: string;
}

/** Closing panel: a wide glass sheet with a brand bloom bleeding past its edges. */
export function FinalCta({ ctaHref }: FinalCtaProps) {
  return (
    <section className="relative px-6 pb-28">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-border glass px-6 py-16 text-center hairline-sheen sm:px-16">
        <GlowOrb
          className="-left-24 -top-24 h-72 w-72"
          color="primary"
          delay={0}
        />
        <GlowOrb
          className="-bottom-24 -right-16 h-72 w-72"
          color="fuchsia"
          delay={2}
        />

        <div className="relative z-10 flex flex-col items-center gap-6">
          <Reveal>
            <h2 className="text-gradient max-w-xl text-4xl font-bold tracking-tight sm:text-5xl">
              Start talking to Elara{" "}
              <span className="font-display italic text-primary-soft">
                tonight
              </span>
              .
            </h2>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
              Your first conversation is one tap away — and it stays yours.
            </p>
          </Reveal>

          <Reveal
            delay={0.2}
            className="flex flex-col items-center gap-3 sm:flex-row"
          >
            <ButtonLink href={ctaHref} size="lg">
              Start Talking
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/signup" variant="secondary" size="lg">
              Create free account
            </ButtonLink>
          </Reveal>

          <Reveal delay={0.3}>
            <p className="text-xs text-muted-foreground">
              No credit card · Guest mode available
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
