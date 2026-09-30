import type {
  BrainMeta,
  BrainProgress,
  BrainProgressCallback,
  BrainResult,
  BrainTurn,
  EmotionHint,
  ReplyLanguage,
} from "@/lib/brain/types";
import { CLIENT_FALLBACK_REPLY } from "@/lib/brain/types";

/**
 * Client-side helper for the Main Brain.
 *
 * This module is deliberately dumb and secret-free: it POSTs the finalized
 * transcript to `/api/brain` and resolves with reply text no matter what —
 * network failure, HTTP error, timeout — so the voice loop ALWAYS has something
 * to speak. All credentials live server-side.
 *
 * The reply arrives as a newline-delimited JSON STREAM — zero or more
 * `{"type":"progress",…}` lines (`searching` → `searched`, for LIVE turns
 * only), then one `{"type":"done","reply":…,"meta":…}` line. A JSON body
 * (from error paths) is still accepted defensively. Progress lines carry no
 * content — never the query, the results or a provider name — only the phase,
 * which the voice loop turns into "Searching live…" / "Found live results".
 */

const BRAIN_TIMEOUT_MS = 15_000;

/**
 * Extended budget granted to a LIVE turn: the progress lines prove a lookup
 * is in flight, and a 2–6 s lookup plus a grounded synthesis can legitimately
 * exceed the ordinary 15 s ceiling. Chat turns keep the short timeout, so the
 * loop never waits longer than today on plain conversation.
 */
const LIVE_TURN_TIMEOUT_MS = 30_000;

export const CLIENT_BRAIN_FALLBACK = CLIENT_FALLBACK_REPLY;

const fallbackResult = (): BrainResult => ({
  reply: CLIENT_BRAIN_FALLBACK,
  meta: {
    usedSearch: false,
    fastAssist: false,
    reorganized: false,
    guardBlocked: false,
    fellBack: true,
  },
});

export async function requestBrainReply(
  text: string,
  history: BrainTurn[],
  /** Full-turn language lock from the client — drives the reply language. */
  language: ReplyLanguage = "en",
  /** Deterministic emotion hint from the transcript — colours the reply's tone. */
  emotion: EmotionHint | null = null,
  /**
   * Optional caller-owned abort. The voice loop passes one per turn so a Stop
   * that lands while the brain is still thinking cancels the request instead of
   * letting a reply arrive for a session that has already ended.
   *
   * An aborted request resolves to the same client fallback as any other
   * failure — the caller then sees a stale turn and discards it — so no code
   * path here can throw into the loop.
   */
  abortSignal?: AbortSignal,
  /**
   * Optional sink for the server's live-search phases (`searching` →
   * `searched`). The voice loop uses it to flip the status to
   * `searching` / `search-found` while the reply is still being computed.
   * Never required — the reply resolves identically without it.
   */
  onProgress?: BrainProgressCallback
): Promise<BrainResult> {
  /*
   * Internal controller so the request timeout and the caller's abort share one
   * signal, without depending on `AbortSignal.any` (not in every browser).
   */
  const controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      abortSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  try {
    const response = await fetch("/api/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, turns: history, language, emotion }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return fallbackResult();
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { reply?: unknown };

      if (typeof payload.reply !== "string" || payload.reply.length === 0) {
        return fallbackResult();
      }

      return {
        reply: payload.reply,
        meta: (payload as { meta?: BrainMeta }).meta ?? fallbackResult().meta,
      };
    }

    if (!response.body) {
      return fallbackResult();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: BrainResult | null = null;
    let liveBudgetGranted = false;

    const handleLine = (line: string): void => {
      if (line.trim().length === 0) {
        return;
      }

      let message: {
        type?: unknown;
        phase?: unknown;
        found?: unknown;
        reply?: unknown;
        meta?: unknown;
      };

      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }

      if (message.type === "progress") {
        /*
         * Proof of a LIVE lookup in flight — extend the deadline once so the
         * search plus the grounded synthesis can finish without the loop
         * cutting them off at the ordinary 15 s ceiling.
         */
        if (!liveBudgetGranted) {
          liveBudgetGranted = true;
          clearTimeout(timeout);
          timeout = setTimeout(() => controller.abort(), LIVE_TURN_TIMEOUT_MS);
        }

        if (onProgress && message.phase === "searching") {
          const progress: BrainProgress = { phase: "searching" };
          onProgress(progress);
        } else if (onProgress && message.phase === "searched") {
          const progress: BrainProgress = {
            phase: "searched",
            found: message.found === true,
          };
          onProgress(progress);
        }
      } else if (
        message.type === "done" &&
        typeof message.reply === "string" &&
        message.reply.length > 0
      ) {
        finalResult = {
          reply: message.reply,
          meta: (message.meta ?? fallbackResult().meta) as BrainMeta,
        };
      }
    };

    for (;;) {
      const { done, value } = await reader.read();

      if (value && value.length > 0) {
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");

        while (newline >= 0) {
          handleLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }

      if (done) {
        if (buffer.trim().length > 0) {
          handleLine(buffer);
        }

        break;
      }
    }

    return finalResult ?? fallbackResult();
  } catch {
    return fallbackResult();
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener("abort", forwardAbort);
  }
}
