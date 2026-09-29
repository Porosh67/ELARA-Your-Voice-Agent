import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const baseStyles = [
  "relative inline-flex select-none items-center justify-center overflow-hidden",
  "whitespace-nowrap rounded-full font-semibold tracking-tight",
  "transition-[background-image,box-shadow,color,border-color] duration-300",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-60",
].join(" ");

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-primary to-primary-soft text-on-primary glow-primary hover:from-primary-soft hover:to-primary",
  secondary:
    "border border-border bg-card text-foreground backdrop-blur-md hover:border-border-strong hover:bg-surface-muted/60",
  ghost: "text-muted-foreground hover:bg-card hover:text-foreground",
  link: "text-primary-soft underline-offset-4 hover:text-primary hover:underline",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-13 px-8 text-base",
};

interface SharedProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

export type ButtonProps = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps> & {
    /** Shows a spinner and disables the button while pending. */
    loading?: boolean;
  };

export type ButtonLinkProps = SharedProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof SharedProps> & {
    href: string;
  };

/** Top hairline highlight — the single detail that sells the glass. */
function TopSheen() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
    />
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    />
  );
}

/**
 * The one button primitive for the whole app.
 *
 * Server-rendered on purpose: hover/focus/press feedback is pure CSS, so this
 * stays out of the client bundle.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {variant === "primary" ? <TopSheen /> : null}
      <span className="relative z-10 inline-flex items-center gap-2">
        {loading ? <Spinner /> : null}
        {children}
      </span>
    </button>
  );
}

/** Anchor version of `Button` for internal/external navigation. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  href,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        "active:scale-[0.98]",
        className,
      )}
      {...props}
    >
      {variant === "primary" ? <TopSheen /> : null}
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>
    </Link>
  );
}
