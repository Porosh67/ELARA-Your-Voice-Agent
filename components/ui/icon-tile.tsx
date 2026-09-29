import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface IconTileProps {
  icon: ReactNode;
  className?: string;
}

/** Gradient-washed icon container used across the Features and Security grids. */
export function IconTile({ icon, className }: IconTileProps) {
  return (
    <div
      className={cn(
        "relative inline-flex h-12 w-12 items-center justify-center rounded-2xl",
        "border border-border bg-surface-muted/80 text-primary-soft",
        "shadow-[inset_0_1px_0_var(--inset-highlight)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-primary/10 to-transparent"
      />
      <span className="relative z-10">{icon}</span>
    </div>
  );
}
