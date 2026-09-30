"use client";

import { useActionState, useCallback, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AuthInput } from "./auth-input";
import { AuthError } from "./auth-error";
import { PasswordStrength } from "./password-strength";
import { UsernameField } from "./username-field";
import { Button } from "@/components/ui/button";
import { signInWithPassword, signUp } from "@/lib/auth/actions";
import {
  initialAuthState,
  type AuthActionState,
} from "@/lib/auth/action-state";
import {
  PASSWORD_MIN_LENGTH,
  isPasswordAcceptable,
  isUsernameWellFormed,
} from "@/lib/auth/password-policy";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  mode: AuthMode;
  redirectTo?: string;
}

/**
 * Email + password form for both login and signup.
 *
 * Uses React 19's `useActionState` to bind the server action and surface
 * validation/auth errors inline. The strength meter and the username check read
 * their values from state updated on the form's `onInput` event, so the inputs
 * themselves stay uncontrolled and nothing is re-rendered per keystroke beyond
 * the fields that need it.
 *
 * VALIDATION IS NOT TRUSTED HERE. The submit button is disabled until the rules
 * pass, which is a courtesy, not a control: `signUp` re-runs the identical
 * shared policy server-side, so a crafted request cannot bypass it.
 */
export function AuthForm({ mode, redirectTo }: AuthFormProps) {
  const action = mode === "login" ? signInWithPassword : signUp;
  const [state, formAction] = useActionState<AuthActionState, FormData>(
    action,
    initialAuthState,
  );

  const [passwordValue, setPasswordValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [usernameValue, setUsernameValue] = useState("");
  const [usernameOk, setUsernameOk] = useState(true);
  const [touchedConfirm, setTouchedConfirm] = useState(false);

  const handleInput = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLInputElement;

    if (target.name === "password") {
      setPasswordValue(target.value);
    } else if (target.name === "confirmPassword") {
      setConfirmValue(target.value);
      setTouchedConfirm(true);
    }
  };

  const passwordOk = isPasswordAcceptable(passwordValue);
  const confirmError =
    touchedConfirm && confirmValue.length > 0 && confirmValue !== passwordValue
      ? "Passwords do not match."
      : null;

  // A callback identity that is stable, so the field's effect does not re-run
  // (and re-report validity) on every parent render.
  const handleUsernameValidity = useCallback((canSubmit: boolean) => {
    setUsernameOk(canSubmit);
  }, []);

  const signupReady =
    isUsernameWellFormed(usernameValue) &&
    usernameOk &&
    passwordOk &&
    confirmValue.length > 0 &&
    confirmValue === passwordValue;

  return (
    <form action={formAction} onInput={handleInput} className="flex flex-col gap-4">
      {redirectTo ? (
        <input type="hidden" name="redirect" value={redirectTo} />
      ) : null}

      {mode === "signup" ? (
        <>
          <AuthInput
            id="fullName"
            name="fullName"
            type="text"
            label="Full name"
            placeholder="Ada Lovelace"
            autoComplete="name"
            maxLength={120}
            required
          />

          <UsernameField
            value={usernameValue}
            onChange={setUsernameValue}
            onValidityChange={handleUsernameValidity}
          />
        </>
      ) : null}

      <AuthInput
        id="email"
        name="email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        autoComplete="email"
        required
      />

      <AuthInput
        id="password"
        name="password"
        type="password"
        label="Password"
        placeholder="••••••••••••••••"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        minLength={mode === "login" ? undefined : PASSWORD_MIN_LENGTH}
        revealable
        required
      />

      {mode === "signup" ? (
        <>
          <PasswordStrength password={passwordValue} />

          <AuthInput
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            label="Confirm password"
            placeholder="••••••••••••••••"
            autoComplete="new-password"
            revealable
            required
            error={confirmError}
          />
        </>
      ) : (
        /* LOGIN ONLY: the escape hatch for a forgotten password. */
        <div className="-mt-1 text-right">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary-soft transition-colors hover:text-primary"
          >
            Forgot password?
          </Link>
        </div>
      )}

      <AuthError error={state.error ?? confirmError} message={state.message} />

      <SubmitButton mode={mode} disabled={mode === "signup" ? !signupReady : false} />
    </form>
  );
}

function SubmitButton({ mode, disabled }: { mode: AuthMode; disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      loading={pending}
      disabled={disabled || pending}
      className="mt-2 w-full"
      size="md"
    >
      {pending
        ? mode === "login"
          ? "Logging in…"
          : "Creating account…"
        : mode === "login"
          ? "Log in"
          : "Create account"}
    </Button>
  );
}
