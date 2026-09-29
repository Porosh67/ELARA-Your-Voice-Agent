import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  icon?: ReactNode;
  /** Renders an animated status dot (e.g. "live"). */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}

/** Frosted pill used for eyebrows, announcements and micro-proofs. */
export function Badge({ icon, pulse = false, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5",
        "text-xs font-medium tracking-wide text-muted-foreground backdrop-blur-md",
        "hairline-sheen",
        className,
      )}
    >
      {pulse ? (
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
      ) : null}
      {icon}
      {children}
    </span>
  );
}
