import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { createClient } from "@/lib/supabase/server";

/**
 * The new-password page, reachable ONLY with a valid recovery session.
 *
 * Supabase's recovery link lands on `/auth/callback?next=/reset-password`, which
 * exchanges the one-time `code` for a session and forwards here. Without that
 * exchange there is no session, and this page refuses to render a form — the
 * alternative, showing the form and failing on submit, wastes the person's time
 * and implies the page is broken.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (data.user === null) {
    redirect("/forgot-password?reason=expired");
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="Pick something strong — you'll use it every time you sign in."
    >
      <div className="flex flex-col gap-6">
        <ResetPasswordForm />

        <p className="text-center text-xs text-muted-foreground">
          Changed your mind?{" "}
          <Link
            href="/login"
            className="font-medium text-primary-soft transition-colors hover:text-primary"
          >
            Back to log in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
