export interface NavLink {
  label: string;
  href: string;
}

/** Shared landing-page anchors used by the desktop nav and the mobile sheet. */
export const NAV_LINKS: NavLink[] = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Security", href: "/#security" },
];
