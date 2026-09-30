import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AuroraBackground } from "@/components/ui/aurora-background";

/**
 * Shared shell for the plain-text legal pages.
 *
 * Kept deliberately plain: no marketing copy, no claims that need footnotes.
 * These pages exist so a person can find out what happens to their data without
 * having to trust a summary on another screen.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-1 flex-col">
      <AuroraBackground />

      <header className="relative z-10 w-full border-b border-border/40 bg-background/20 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-6 px-6 py-5">
          <Logo />
          <Link
            href="/settings"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/60 px-3 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
        </div>
      </header>

      <main
        id="main-content"
        className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-6 pb-20 pt-10"
      >
        <h1 className="text-gradient text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>

        <div className="mt-8 flex flex-col gap-8 text-sm leading-relaxed text-foreground/85">
          {children}
        </div>
      </main>
    </div>
  );
}

/** A titled block, so every page reads as the same kind of document. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5">{children}</ul>;
}

/** Guards the legal pages so a signed-in person is not shown a dead end. */
export function requireUser() {
  redirect("/login?redirect=/privacy");
}
