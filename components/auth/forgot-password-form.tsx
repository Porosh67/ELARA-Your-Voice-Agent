"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AuthInput } from "@/components/auth/auth-input";
import { AuthError } from "@/components/auth/auth-error";
import { Button } from "@/components/ui/button";

/**
 * "Email or username" → a reset link, if the account exists.
 *
 * The component's job is to be USEFUL and UNINFORMATIVE. It never says whether
 * an account was found, never reveals that an identifier is a username rather
 * than an address, and shows the same confirmation either way — the server
 * returns one fixed sentence and this page simply renders it.
 *
 * Rate limiting is per-IP and per-identifier on the server, so this form can be
 * submitted freely without becoming a way to test a list of addresses.
 */
export function ForgotPasswordForm() {
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = identifier.trim();

    if (value.length === 0) {
      setError("Enter your email address or username.");
      setMessage(null);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: value }),
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;

      // Whatever happened, the page says the same thing. A non-OK status still
      // renders the generic confirmation rather than an error, because telling
      // the difference is exactly the information this page must not leak.
      setMessage(
        typeof payload?.message === "string"
          ? payload.message
          : "If an account exists, a reset link has been sent. Check your inbox."
      );
      setIdentifier("");
    } catch {
      setMessage(
        "If an account exists, a reset link has been sent. Check your inbox."
      );
    } finally {
      setPending(false);
    }
  }

  if (message !== null) {
    return (
      <div className="flex flex-col gap-4">
        <AuthError error={null} message={message} />
        <Button
          type="button"
          variant="ghost"
          onClick={() => setMessage(null)}
          className="w-full"
          size="md"
        >
          Send to a different account
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <AuthInput
        id="identifier"
        name="identifier"
        type="text"
        label="Email or username"
        placeholder="you@example.com"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        maxLength={320}
        required
      />

      <AuthError error={error} message={null} />

      <Button type="submit" loading={pending} disabled={pending} className="w-full" size="md">
        {pending ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-primary-soft transition-colors hover:text-primary"
        >
          Back to log in
        </Link>
      </p>
    </form>
  );
}
