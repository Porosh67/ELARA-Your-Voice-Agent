import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionProps {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  subtitle?: string;
  align?: "center" | "left";
  className?: string;
  children: ReactNode;
}

/**
 * Consistent section shell: eyebrow → headline → subcopy → content, with a
 * shared vertical rhythm so every landing section lands on the same grid.
 */
export function Section({
  id,
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "relative mx-auto w-full max-w-6xl px-6 py-24 sm:py-32",
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-col gap-4",
          align === "center" ? "items-center text-center" : "items-start text-left",
        )}
      >
        {eyebrow ? (
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-soft">
            {eyebrow}
          </span>
        ) : null}

        <h2 className="text-gradient max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          {title}
        </h2>

        {subtitle ? (
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </header>

      <div className="mt-14">{children}</div>
    </section>
  );
}
