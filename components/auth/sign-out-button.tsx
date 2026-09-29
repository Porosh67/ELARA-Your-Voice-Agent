"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

/**
 * Sign-out button. Calls the `signOut` server action which clears the session
 * cookies and redirects home.
 */
export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          await signOut();
        })
      }
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      {isPending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
