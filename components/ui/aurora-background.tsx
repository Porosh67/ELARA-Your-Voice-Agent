import { cn } from "@/lib/utils";

interface AuroraBackgroundProps {
  className?: string;
  /** Renders the radially masked hairline grid layer. */
  grid?: boolean;
  /** Renders the film-grain overlay. */
  grain?: boolean;
}

/**
 * Layered ambient backdrop: base wash, three drifting aurora blooms, a
 * radially-masked hairline grid and a film-grain overlay.
 *
 * Pure CSS (server component) — no client JS, and every layer is
 * `pointer-events-none` + `aria-hidden`.
 */
export function AuroraBackground({
  className,
  grid = true,
  grain = true,
}: AuroraBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      {/* Base wash */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,var(--aurora-1),transparent_60%)]" />

      {/* Drifting blooms */}
      <div className="absolute -left-40 top-[-20%] h-[70vh] w-[70vh] animate-aurora rounded-full bg-[radial-gradient(circle,var(--aurora-2),transparent_65%)] blur-3xl" />
      <div className="absolute right-[-15%] top-[10%] h-[60vh] w-[60vh] animate-aurora rounded-full bg-[radial-gradient(circle,var(--aurora-3),transparent_65%)] blur-3xl [animation-delay:-9s]" />
      <div className="absolute bottom-[-25%] left-[20%] h-[55vh] w-[55vh] animate-aurora rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_65%)] blur-3xl [animation-delay:-17s]" />

      {/* Hairline grid */}
      {grid ? (
        <div className="absolute inset-0 grid-pattern opacity-70 [mask-image:radial-gradient(80%_60%_at_50%_0%,black,transparent)]" />
      ) : null}

      {/* Film grain */}
      {grain ? (
        <div className="absolute inset-0 noise opacity-[0.025] mix-blend-overlay dark:opacity-[0.035]" />
      ) : null}
    </div>
  );
}
