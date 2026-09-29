import type {
  BrainMeta,
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
 */

const BRAIN_TIMEOUT_MS = 15_000;

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
  emotion: EmotionHint | null = null
): Promise<BrainResult> {
  try {
    const response = await fetch("/api/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, turns: history, language, emotion }),
      cache: "no-store",
      signal: AbortSignal.timeout(BRAIN_TIMEOUT_MS),
    });

    if (!response.ok) {
      return fallbackResult();
    }

    const payload = (await response.json()) as { reply?: unknown };

    if (typeof payload.reply !== "string" || payload.reply.length === 0) {
      return fallbackResult();
    }

    return {
      reply: payload.reply,
      meta: (payload as { meta?: BrainMeta }).meta ?? fallbackResult().meta,
    };
  } catch {
    return fallbackResult();
  }
}
