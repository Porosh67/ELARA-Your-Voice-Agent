"use client";

import { useCallback, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  /** Spotlight radius in px. */
  radius?: number;
}

/**
 * Glass card with a mouse-tracked radial spotlight and a gentle lift on hover.
 * Positions are written straight to CSS custom properties (no React state) so
 * pointer movement never triggers a re-render.
 */
export function SpotlightCard({
  children,
  className,
  radius = 320,
}: SpotlightCardProps) {
  const handleMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
    },
    [],
  );

  return (
    <div
      onPointerMove={handleMove}
      className={cn(
        "group relative isolate overflow-hidden rounded-3xl",
        "glass hairline-sheen border border-border",
        "transition-[border-color,transform,box-shadow] duration-300",
        "hover:-translate-y-0.5 hover:border-border-strong",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(${radius}px circle at var(--spotlight-x, 50%) var(--spotlight-y, 0%), var(--glow), transparent 70%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
