import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthDivider } from "@/components/auth/auth-divider";
import { GoogleButton } from "@/components/auth/google-button";
import { GuestButton } from "@/components/auth/guest-button";

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your account"
      subtitle="Join Elara for private, real-time voice conversations."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary-soft transition-colors hover:text-primary"
          >
            Log in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <AuthForm mode="signup" />

        <AuthDivider />

        <div className="flex flex-col gap-3">
          <GoogleButton />
          <GuestButton />
        </div>
      </div>
    </AuthCard>
  );
}