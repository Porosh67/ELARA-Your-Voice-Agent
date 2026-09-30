import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const linkGroups = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Security", href: "/#security" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Create account", href: "/signup" },
      { label: "Open Elara", href: "/app" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-14">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-xs flex-col gap-4">
            <Logo />
            <p className="text-sm leading-relaxed text-muted-foreground">
              A secure, real-time voice friend that listens the way people do.
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="flex flex-col gap-8 sm:flex-row sm:gap-16"
          >
            {linkGroups.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {group.title}
                </h3>
                <ul className="flex flex-col gap-2.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-foreground/80 transition-colors duration-200 hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Elara AI. Private by design.
          </p>
          <ThemeToggle variant="compact" />
        </div>
      </div>
    </footer>
  );
}
