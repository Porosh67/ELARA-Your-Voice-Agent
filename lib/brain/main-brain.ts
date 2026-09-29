import "server-only";

import { isGroqConfigured } from "@/lib/brain/env";
import {
  BRAIN_NOT_CONFIGURED_REPLY,
  INPUT_BLOCKED_REPLY,
  OUTPUT_BLOCKED_REPLY,
  SAFE_FALLBACK_REPLY,
  SEARCH_SYNTHESIS_FAILED_REPLY,
  emptyMeta,
  isCannedReply,
} from "@/lib/brain/types";
import type {
  BrainResult,
  BrainTurn,
  EmotionHint,
  ReplyLanguage,
} from "@/lib/brain/types";
import { inputSafetyPasses, outputSafetyPasses } from "@/lib/brain/stages/safety";
import { classifyRequest, containsCredentialLikeText, policyReplyFor } from "@/lib/brain/safety-policy";
import { containsCapabilityLeak, stageRespond } from "@/lib/brain/stages/respond";
import { polishForSpokenText, stageReorganize } from "@/lib/brain/stages/reorganize";

/**
 * Elara's last actually-spoken line in the history, or `null` when there is none.
 *
 * "Spoken" excludes canned lines, which are filtered out of the history anyway:
 * a fallback or refusal was never really Elara talking, so it must not steer the
 * next turn's wording. Read newest-first and only ever used as the anti-echo
 * hint, so the earliest turns cost nothing.
 */
function previousAssistantLine(turns: BrainTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];

    if (turn.speaker === "you" || isCannedReply(turn.text)) {
      continue;
    }

    const text = turn.text.trim();

    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

/**
 * THE MAIN BRAIN — the locked critical path, in order:
 *
 *   1. Input safety    → llama-prompt-guard-2-86m   (Groq)
 *   2. Fast assist     → gemini-3.5-flash-lite      (Google AI Studio, ≤800 ms)
 *   3. Main response   → gpt-oss-120b               (Groq, + optional SERP)
 *   4. Reorganize      → qwen3.8-27b                (Groq; fallback nemotron-3-nano)
 *   5. Output safety   → gpt-oss-safeguard-20b      (Groq)
 *
 * Steps 2 and 3 both live inside `stageRespond` and run CONCURRENTLY, so the
 * reply is never gated on the assist — the assist only ever helps it.
 *
 * Every failure path ends in a SAFE message that still reaches TTS, so the
 * voice loop can never die inside the brain.
 */
export async function runMainBrain(input: {
  text: string;
  turns: BrainTurn[];
  /** Full-turn language lock, sent by the client — never re-guessed here. */
  language?: ReplyLanguage;
  /** Deterministic emotion hint from the transcript — colours the tone only. */
  emotion?: EmotionHint | null;
}): Promise<BrainResult> {
  const language = input.language ?? "en";

  /*
   * Deterministic policy gate — BEFORE everything, including the model input
   * guard, so credential requests, jailbreaks and harmful asks are refused
   * instantly (zero latency, no network) and even when Groq is unconfigured.
   * Ordinary chat returns "allow" and continues untouched: this layer fails
   * closed on the narrow set that deserves it WITHOUT ever recreating the
   * refusal loop on normal conversation.
   */
  const verdict = classifyRequest(input.text);

  if (verdict !== "allow") {
    return {
      reply: policyReplyFor(verdict) ?? INPUT_BLOCKED_REPLY,
      meta: { ...emptyMeta(), guardBlocked: true },
    };
  }

  // Without Groq there is no critical path at all — speak a clear, safe line.
  if (!isGroqConfigured()) {
    return {
      reply: BRAIN_NOT_CONFIGURED_REPLY,
      meta: { ...emptyMeta(), fellBack: true },
    };
  }

  try {
    // ── Step 1: input safety ─────────────────────────────────────────────────
    const inputOk = await inputSafetyPasses(input.text);

    if (inputOk === false) {
      return {
        reply: INPUT_BLOCKED_REPLY,
        meta: { ...emptyMeta(), guardBlocked: true },
      };
    }
    // null → guard couldn't run; fail open rather than deafen the loop.

    // ── Steps 2 + 3: fast assist, then the main response ─────────────────────
    const responded = await stageRespond(
      input.text,
      input.turns,
      language,
      input.emotion ?? null
    );

    // Output-side policy hit (credential-shaped reply): the canned refusal is
    // already safe to speak and is filtered from history like every canned line.
    if (responded.policyBlocked !== null) {
      return {
        reply: responded.reply,
        meta: { ...emptyMeta(), guardBlocked: true },
      };
    }

    // ── Step 4: reorganize + emotion ─────────────────────────────────────────
    /*
     * The tone hint travels WITH the draft, and so does Elara's previous line.
     * Without the hint, Step 4 rewrote a mood-matched draft back into an
     * even-toned one (the "emotion comes out uneven" report); without the
     * previous line, it had no way to know which opening the person just heard
     * and converged on the same one (the "same stock reply" report). Both are
     * inputs to the SAME single rewrite call — no extra model call, no extra
     * latency, no change to the output safety model.
     */
    const reorganized = await stageReorganize(
      responded.reply,
      input.text,
      input.emotion ?? null,
      previousAssistantLine(input.turns)
    );
    const draft = polishForSpokenText(reorganized ?? responded.reply);

    // ── Step 5: output safety ────────────────────────────────────────────────
    /*
     * Post-Step-4 re-check. stageRespond scrubs the draft it produced, but Step 4
     * runs AFTER that and is a model, so it can reintroduce a credential-shaped
     * string or an internal service name. Failing closed on the credential case
     * is deliberate: an invented key spoken aloud is indistinguishable to the
     * listener from a real leak.
     */
    if (containsCredentialLikeText(draft)) {
      return {
        reply: policyReplyFor("secret") ?? OUTPUT_BLOCKED_REPLY,
        meta: { ...emptyMeta(), guardBlocked: true },
      };
    }

    /*
     * Capability/provider scrub on the FINAL text. The leaking draft is dropped
     * for the pre-Step-4 reply when that one is clean, or for the honest canned
     * line otherwise - so no provider name or model id can ever be spoken.
     */
    if (!isCannedReply(draft) && containsCapabilityLeak(draft)) {
      return {
        reply: isCannedReply(responded.reply)
          ? SEARCH_SYNTHESIS_FAILED_REPLY
          : responded.reply,
        meta: {
          usedSearch: responded.usedSearch,
          fastAssist: responded.fastAssist,
          reorganized: false,
          guardBlocked: false,
          fellBack: false,
        },
      };
    }

    const outputOk = await outputSafetyPasses(input.text, draft);

    if (outputOk === false) {
      return {
        reply: OUTPUT_BLOCKED_REPLY,
        meta: {
          usedSearch: responded.usedSearch,
          fastAssist: responded.fastAssist,
          reorganized: reorganized !== null,
          guardBlocked: true,
          fellBack: false,
        },
      };
    }

    return {
      reply: draft,
      meta: {
        usedSearch: responded.usedSearch,
        fastAssist: responded.fastAssist,
        reorganized: reorganized !== null,
        guardBlocked: false,
        fellBack: false,
      },
    };
  } catch {
    // A stage threw (shouldn't happen — providers return null) — still speak.
    return {
      reply: SAFE_FALLBACK_REPLY,
      meta: { ...emptyMeta(), fellBack: true },
    };
  }
}
