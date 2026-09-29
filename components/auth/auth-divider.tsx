/**
 * Visual "or continue with" separator matching the design system.
 */
export function AuthDivider({ label = "or continue with" }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-4">
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
    </div>
  );
}
