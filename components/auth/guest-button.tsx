"use client";

import { useTransition } from "react";
import { UserRound } from "lucide-react";
import { signInAsGuest } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

/**
 * Guest (anonymous) sign-in button. Calls the `signInAsGuest` server action.
 * Guests get a temporary account that can later be upgraded to a full account.
 */
export function GuestButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          await signInAsGuest();
        })
      }
      className="w-full"
    >
      <UserRound className="h-5 w-5" aria-hidden="true" />
      {isPending ? "Starting…" : "Continue as Guest"}
    </Button>
  );
}
