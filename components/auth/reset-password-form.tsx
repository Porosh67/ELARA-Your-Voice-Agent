"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthInput } from "@/components/auth/auth-input";
import { AuthError } from "@/components/auth/auth-error";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  PASSWORD_MIN_LENGTH,
  isPasswordAcceptable,
} from "@/lib/auth/password-policy";

/**
 * Set a new password from a recovery link.
 *
 * The page decides whether there is a valid recovery session; this form only
 * runs when one exists. Re-checking here would be theatre — the server rejects
 * the update regardless, because a password change requires a real session.
 *
 * On success the user is signed OUT and sent to /login. That is deliberate: a
 * recovery session is a one-shot, short-lived grant, and leaving it active after
 * a password change would keep a privileged session alive on a device that may
 * not be the one that requested the reset.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const passwordOk = isPasswordAcceptable(password);
  const confirmError =
    touchedConfirm && confirm.length > 0 && confirm !== password
      ? "Passwords do not match."
      : null;

  const ready = passwordOk && confirm.length > 0 && confirm === password;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Re-checked here as well as in the UI: the disabled button is a courtesy.
    if (!isPasswordAcceptable(password)) {
      setError(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, a number and a symbol.`
      );
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        // The recovery link may have expired between page load and submit.
        setError(
          "That reset link is no longer valid. Request a new one and try again."
        );
        return;
      }

      // Drop the recovery session before leaving, so the link cannot be reused.
      await supabase.auth.signOut();

      router.push("/login?reset=success");
      router.refresh();
    } catch {
      setError("Something went wrong. Please request a new reset link.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <AuthInput
        id="newPassword"
        name="newPassword"
        type="password"
        label="New password"
        placeholder="••••••••••••••••"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        revealable
        required
      />

      <PasswordStrength password={password} />

      <AuthInput
        id="confirmNewPassword"
        name="confirmNewPassword"
        type="password"
        label="Confirm new password"
        placeholder="••••••••••••••••"
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => {
          setConfirm(event.target.value);
          setTouchedConfirm(true);
        }}
        revealable
        required
        error={confirmError}
      />

      <AuthError error={error ?? confirmError} message={null} />

      <Button
        type="submit"
        loading={pending}
        disabled={!ready || pending}
        className="w-full"
        size="md"
      >
        {pending ? "Updating…" : "Update password"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        <Link
          href="/forgot-password"
          className="font-medium text-primary-soft transition-colors hover:text-primary"
        >
          Request a new link
        </Link>
      </p>
    </form>
  );
}
