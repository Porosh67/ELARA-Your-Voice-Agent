"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { AuthInput } from "./auth-input";
import {
  USERNAME_HINT,
  isUsernameWellFormed,
  normalizeUsername,
  usernameFormatError,
} from "@/lib/auth/password-policy";

/** How long typing pauses before a check is sent. */
const DEBOUNCE_MS = 400;

type Availability = "idle" | "available" | "taken" | "unknown";

interface UsernameFieldProps {
  /** The current value, owned by the parent form. */
  value: string;
  onChange: (value: string) => void;
  /** Fired whenever the field's validity changes, so submit can be gated. */
  onValidityChange?: (canSubmit: boolean) => void;
  id?: string;
  name?: string;
}

/**
 * Username input with a LIVE availability check.
 *
 * The check is a hint, never the authority: the unique index on
 * lower(username) decides who actually wins a race, and the signup action
 * reports a collision as a normal "that one's taken". This component therefore
 * only ever DISABLES submit while it is actively checking or has a definite
 * problem — a network failure reports "unknown" and does not block the person,
 * because the server will catch a real collision anyway.
 *
 * Requests are debounced, aborted on change, and skipped entirely for a
 * malformed username, so typing never produces a burst of pointless calls.
 */
export function UsernameField({
  value,
  onChange,
  onValidityChange,
  id = "username",
  name = "username",
}: UsernameFieldProps) {
  const [availability, setAvailability] = useState<Availability>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const normalized = normalizeUsername(value);
  const formatError = usernameFormatError(value);
  const wellFormed = isUsernameWellFormed(value);

  /*
   * DERIVED, not stored: while the value is malformed there is nothing to
   * check, so the field reads as idle without an effect ever setting state.
   * "Checking" is also derived — it is simply the state while a debounce is
   * pending — which keeps the display honest even if a request is abandoned.
   */
  const shown: Availability = !wellFormed ? "idle" : availability;
  const isChecking = shown === "idle" && wellFormed;

  /*
   * A format problem is always a hard block — it can never be registered.
   * Everything else is soft: "taken" blocks, "unknown" does not.
   */
  const canSubmit =
    wellFormed && (shown === "available" || shown === "unknown" || shown === "idle");

  useEffect(() => {
    onValidityChange?.(canSubmit);
  }, [canSubmit, onValidityChange]);

  useEffect(() => {
    // Cancel whatever the previous keystroke started.
    abortRef.current?.abort();
    abortRef.current = null;

    if (!wellFormed) {
      // No timer and no fetch: there is nothing to check. The displayed status
      // is derived from `availability`, which only matters while well-formed,
      // so it is reset as part of the same render rather than in this effect —
      // setting it here would be a synchronous setState inside an effect body.
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/auth/username-available", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: normalized }),
            signal: controller.signal,
            cache: "no-store",
          });

          if (!response.ok) {
            // 429 included: unknown, so submit is NOT blocked. The server is
            // still the authority and will reject a genuine collision.
            setAvailability("unknown");
            return;
          }

          const payload = (await response.json()) as { available?: unknown };
          setAvailability(payload.available === true ? "available" : "taken");
        } catch (error) {
          // An abort is the expected outcome of typing another character.
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setAvailability("unknown");
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, wellFormed]);

  const status =
    formatError !== null
      ? { tone: "error" as const, text: formatError }
      : isChecking
        ? { tone: "muted" as const, text: "Checking availability…" }
        : shown === "available"
          ? { tone: "ok" as const, text: `${normalized} is available` }
          : shown === "taken"
            ? { tone: "error" as const, text: "That username is already taken" }
            : shown === "unknown"
              ? { tone: "muted" as const, text: "Could not check right now" }
              : null;

  return (
    <div className="flex flex-col gap-2">
      <AuthInput
        id={id}
        name={name}
        type="text"
        label="Username"
        placeholder="your_handle"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={20}
        required
        error={status?.tone === "error" ? status.text : null}
        aria-describedby={`${id}-status`}
      />

      {/* Live region so the result is announced, not just coloured. */}
      <p
        id={`${id}-status`}
        aria-live="polite"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        {isChecking ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        ) : status?.tone === "ok" ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
        ) : status?.tone === "error" ? (
          <X className="h-3 w-3 shrink-0 text-red-500" aria-hidden="true" />
        ) : null}

        {status?.text ?? USERNAME_HINT}
      </p>
    </div>
  );
}
