import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email address or username and we'll send a reset link."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
