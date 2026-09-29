import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Adds the gradient hairline sheen along the top edge. */
  sheen?: boolean;
}

/**
 * Frosted glass surface: translucent fill, backdrop blur, hairline border and
 * an inset top highlight. Decorative children should keep `pointer-events-none`.
 */
export function GlassCard({
  children,
  className,
  sheen = true,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-3xl border border-border",
        "glass shadow-[0_8px_40px_-16px_rgba(0,0,0,0.28)]",
        sheen && "hairline-sheen",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
