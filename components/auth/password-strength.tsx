"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PASSWORD_RULES,
  PASSWORD_STRENGTH_LABELS,
  passwordStrengthLevel,
  type PasswordStrengthLevel,
} from "@/lib/auth/password-policy";

/**
 * Segment colour per level. Index 0 is the empty state, so an unfilled meter
 * never looks like a red warning before anything has been typed.
 */
const SEGMENT_COLORS: Record<PasswordStrengthLevel, string> = {
  0: "bg-foreground/10",
  1: "bg-red-500/70",
  2: "bg-amber-500/70",
  3: "bg-primary/70",
  4: "bg-emerald-500/70",
};

interface PasswordStrengthProps {
  password: string;
  /** Hide the per-rule checklist where space is tight (the reset form). */
  showChecklist?: boolean;
}

/**
 * Live strength meter (4 segments + label) and the checklist of unmet rules.
 *
 * The scoring comes from the SHARED policy module, never from a local copy, so
 * the meter cannot disagree with the server: if a rule shows as met here, the
 * server accepts it, and vice versa.
 *
 * Rendered as a live region so a screen reader hears the label change as the
 * person types.
 */
export function PasswordStrength({
  password,
  showChecklist = true,
}: PasswordStrengthProps) {
  const { level, unmet } = useMemo(() => {
    const metIds = new Set(
      PASSWORD_RULES.filter((rule) => rule.test(password)).map((rule) => rule.id)
    );

    return {
      level: passwordStrengthLevel(password),
      unmet: new Set(
        PASSWORD_RULES.filter((rule) => !metIds.has(rule.id)).map((rule) => rule.id)
      ),
    };
  }, [password]);

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
              index < level ? SEGMENT_COLORS[level] : "bg-foreground/10"
            )}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Password strength:{" "}
        <span className="text-foreground/90">{PASSWORD_STRENGTH_LABELS[level]}</span>
      </p>

      {showChecklist ? (
        <ul className="flex flex-col gap-1">
          {PASSWORD_RULES.map((rule) => {
            const met = !unmet.has(rule.id);

            return (
              <li
                key={rule.id}
                className={cn(
                  "flex items-center gap-1.5 text-xs transition-colors",
                  met ? "text-emerald-500 dark:text-emerald-400" : "text-muted-foreground"
                )}
              >
                {met ? (
                  <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                ) : (
                  <X className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
                )}
                <span>{rule.label}</span>
                <span className="sr-only">{met ? " — met" : " — not met yet"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
