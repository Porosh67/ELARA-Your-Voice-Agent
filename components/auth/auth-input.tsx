"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
  /** Renders a show/hide toggle (for password fields). */
  revealable?: boolean;
  /** Optional inline validation message shown under the field. */
  error?: string | null;
  className?: string;
}

/**
 * Accessible, themed text input with a refined focus ring and an optional
 * password reveal toggle.
 */
export function AuthInput({
  label,
  id,
  revealable = false,
  error = null,
  className,
  type,
  ...props
}: AuthInputProps) {
  const [revealed, setRevealed] = useState(false);
  const resolvedType = revealable ? (revealed ? "text" : "password") : type;
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground/90">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type={resolvedType}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-xl border bg-card px-4 py-3 text-sm text-foreground",
            "placeholder:text-muted-foreground/70 outline-none",
            "transition-[border-color,box-shadow,background-color] duration-200",
            "focus:border-primary/60 focus:ring-2 focus:ring-ring/40",
            "disabled:cursor-not-allowed disabled:opacity-60",
            error
              ? "border-red-500/50 focus:border-red-500/60 focus:ring-red-500/30"
              : "border-border",
            revealable && "pr-11",
            className,
          )}
          {...props}
        />

        {revealable ? (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-500 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
