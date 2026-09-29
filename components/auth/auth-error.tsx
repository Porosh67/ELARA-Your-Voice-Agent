"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { EASE_OUT } from "@/components/ui/reveal";

interface AuthErrorProps {
  error: string | null;
  message?: string | null;
}

/**
 * Inline feedback region for auth forms. Uses `role="alert"` + `aria-live` so
 * screen readers announce errors and success messages, and animates in/out.
 */
export function AuthError({ error, message }: AuthErrorProps) {
  return (
    <div aria-live="polite" className="min-h-0">
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="error"
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            {error}
          </motion.p>
        ) : null}

        {message ? (
          <motion.p
            key="message"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary-soft"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            {message}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
