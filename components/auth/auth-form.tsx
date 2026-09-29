"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { AuthInput } from "./auth-input";
import { AuthError } from "./auth-error";
import { PasswordStrength } from "./password-strength";
import { Button } from "@/components/ui/button";
import { signInWithPassword, signUp } from "@/lib/auth/actions";
import {
  initialAuthState,
  type AuthActionState,
} from "@/lib/auth/action-state";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  mode: AuthMode;
  redirectTo?: string;
}

/**
 * Email + password form for both login and signup.
 * Uses React 19's `useActionState` to bind the server action and surface
 * validation/auth errors inline. A live strength meter reads the password
 * field from the form's `onInput` event, so inputs stay uncontrolled.
 */
export function AuthForm({ mode, redirectTo }: AuthFormProps) {
  const action = mode === "login" ? signInWithPassword : signUp;
  const [state, formAction] = useActionState<AuthActionState, FormData>(
    action,
    initialAuthState,
  );
  const [passwordValue, setPasswordValue] = useState("");

  const handleInput = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLInputElement;
    if (target.name === "password") {
      setPasswordValue(target.value);
    }
  };

  return (
    <form action={formAction} onInput={handleInput} className="flex flex-col gap-4">
      {redirectTo ? (
        <input type="hidden" name="redirect" value={redirectTo} />
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
        placeholder="••••••••"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        minLength={6}
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
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={6}
            revealable
            required
          />
        </>
      ) : null}

      <AuthError error={state.error} message={state.message} />

      <SubmitButton mode={mode} />
    </form>
  );
}

function SubmitButton({ mode }: { mode: AuthMode }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      loading={pending}
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
