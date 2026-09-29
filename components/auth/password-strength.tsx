"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

const LABELS = [
  "Too short",
  "Weak",
  "Fair",
  "Strong",
  "Excellent",
] as const;

const SEGMENT_COLORS = [
  "bg-foreground/10",
  "bg-red-500/70",
  "bg-amber-500/70",
  "bg-primary/70",
  "bg-emerald-500/70",
] as const;

function scorePassword(password: string): number {
  if (password.length < 6) {
    return 0;
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

interface PasswordStrengthProps {
  password: string;
}

/** Four-segment strength meter for the signup form. */
export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { score, label } = useMemo(
    () => {
      const value = scorePassword(password);
      return { score: value, label: LABELS[value] };
    },
    [password],
  );

  if (password.length === 0) {
    return null;
  }

  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      <div aria-hidden="true" className="flex gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              index < score ? SEGMENT_COLORS[score] : "bg-foreground/10",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Password strength:{" "}
        <span className="text-foreground/90">{label}</span>
      </p>
    </div>
  );
}
