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
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ctaHref = user ? "/app" : "/login";

  // Set by the settings delete flow, which has already ended the session.
  const params = await searchParams;
  const justDeleted = params.deleted === "1";

  return (
    <div className="relative flex flex-1 flex-col">
      <AuroraBackground />

      <SiteHeader />

      <main id="main-content" className="flex flex-1 flex-col">
        {justDeleted ? (
          <div className="mx-auto mt-10 w-full max-w-2xl px-6">
            <p
              role="status"
              className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-600 dark:text-emerald-400"
            >
              Your account and all of its data have been deleted. We&apos;re glad
              you were here — you&apos;re welcome back any time.
            </p>
          </div>
        ) : null}

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
