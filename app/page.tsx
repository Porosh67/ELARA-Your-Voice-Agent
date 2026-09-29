import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Hero } from "@/components/landing/hero";
import { StatStrip } from "@/components/landing/stat-strip";
import { Features } from "@/components/landing/features";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Security } from "@/components/landing/security";
import { FinalCta } from "@/components/landing/final-cta";
import { AuroraBackground } from "@/components/ui/aurora-background";

/**
 * Landing page.
 *
 * Reads the session so both the header and the calls to action can point
 * signed-in users straight at `/app` (dynamic rendering is accepted by design).
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ctaHref = user ? "/app" : "/login";

  return (
    <div className="relative flex flex-1 flex-col">
      <AuroraBackground />

      <SiteHeader />

      <main id="main-content" className="flex flex-1 flex-col">
        <Hero ctaHref={ctaHref} />
        <StatStrip />
        <Features />
        <HowItWorks />
        <Security />
        <FinalCta ctaHref={ctaHref} />
      </main>

      <SiteFooter />
    </div>
  );
}
