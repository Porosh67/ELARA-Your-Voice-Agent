import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthDivider } from "@/components/auth/auth-divider";
import { GoogleButton } from "@/components/auth/google-button";
import { GuestButton } from "@/components/auth/guest-button";
import { AuthError } from "@/components/auth/auth-error";

const ERROR_MESSAGES: Record<string, string> = {
  google: "We couldn't start Google sign-in. Please try again.",
  guest: "Guest sign-in is unavailable right now. Please try again.",
  callback: "We couldn't complete sign-in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const redirectParam =
    typeof params.redirect === "string" ? params.redirect : undefined;
  const errorParam = typeof params.error === "string" ? params.error : undefined;
  const presetError = errorParam ? ERROR_MESSAGES[errorParam] ?? null : null;

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to continue talking with Elara."
      footer={
        <>
          {"Don't have an account? "}
          <Link
            href="/signup"
            className="font-medium text-primary-soft transition-colors hover:text-primary"
          >
            Sign up
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <AuthForm mode="login" redirectTo={redirectParam} />

        <AuthDivider />

        <div className="flex flex-col gap-3">
          <GoogleButton />
          <GuestButton />
        </div>

        {presetError ? <AuthError error={presetError} /> : null}
      </div>
    </AuthCard>
  );
}