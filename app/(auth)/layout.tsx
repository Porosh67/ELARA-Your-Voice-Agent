import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/auth-shell";

/**
 * Layout for the `(auth)` route group.
 *
 * All visual chrome (brand panel, theme toggle, aurora) lives in <AuthShell />
 * so both `/login` and `/signup` share exactly one premium shell.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}