import { LogoMark } from "@/components/layout/logo-mark";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Renders only the mark (no wordmark). */
  markOnly?: boolean;
  size?: "sm" | "md" | "lg";
}

const markSizes = {
  sm: "h-6 w-6",
  md: "h-7 w-7",
  lg: "h-9 w-9",
} as const;

const textSizes = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
} as const;

/**
 * Elara logo: the geometric overlapping-blades mark with the "Elara AI"
 * wordmark beside it. The accessible name is provided by the wrapping link,
 * so both parts stay decorative.
 */
export function Logo({ className, markOnly = false, size = "md" }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markSizes[size]} />

      {markOnly ? null : (
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            textSizes[size],
          )}
        >
          Elara AI
        </span>
      )}
    </span>
  );
}
