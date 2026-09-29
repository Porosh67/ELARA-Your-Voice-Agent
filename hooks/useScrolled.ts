"use client";

import { useSyncExternalStore } from "react";

const THRESHOLD = 8;

function subscribe(callback: () => void) {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
}

/**
 * `true` once the window has scrolled past 8px.
 * Implemented with `useSyncExternalStore` so it never causes a hydration
 * mismatch (SSR snapshot is always `false`) and never calls setState.
 */
export function useScrolled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.scrollY > THRESHOLD,
    () => false,
  );
}
