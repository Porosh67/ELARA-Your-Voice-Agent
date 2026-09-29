"use client";

import { useScrolled } from "@/hooks/useScrolled";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface HeaderShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * Sticky header wrapper that turns transparent into frosted glass once the
 * page scrolls, giving every surface below room to breathe.
 */
export function HeaderShell({ children, className }: HeaderShellProps) {
  const scrolled = useScrolled();

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full",
        "transition-[background-color,border-color,box-shadow] duration-300",
        scrolled
          ? "border-b border-border bg-background/80 shadow-[0_8px_30px_-16px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
        className,
      )}
    >
      {children}
    </header>
  );
}
