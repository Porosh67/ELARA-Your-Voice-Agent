import "server-only";

import {
  BRAIN_TIMEOUTS_MS,
  BRAIN_TOKEN_BUDGETS,
  GROQ_MODELS,
  OLLAMA_MODELS,
} from "@/lib/brain/models";
import { groqChat } from "@/lib/brain/providers/groq";
import { ollamaChat } from "@/lib/brain/providers/ollama";
import { looksLikeRefusal } from "@/lib/brain/stages/respond";
import { isCannedReply } from "@/lib/brain/types";
import type { EmotionHint } from "@/lib/brain/types";

/**
 * Step 4 — reorganize + emotion.
 *
 * Qwen rewrites the draft for the ear: warm, natural, brief. If Qwen fails,
 * nemotron-3-nano on Ollama Cloud takes over. If both fail — or if either drifts
 * away from being a polish — the draft itself is spoken unchanged.
 *
 * Step 3 already receives the turn's TONE line, and until now Step 4 did not:
 * the polish pass then rewrote a warm-with-a-low-mood draft back into an
 * even-toned one, which is why the emotion in the prompt came out uneven. The
 * tone line is therefore carried into the rewrite as well — same hint, same
 * turn, no new emotion categories and no model change.
 */

const REWRITE_SYSTEM = [
  "Rewrite the draft reply so it sounds natural when spoken aloud by a warm,",
  "emotionally intelligent voice companion — a friend talking, not a service desk.",
  "Keep every fact and the meaning exactly.",
  "Keep it about the same length; do not add new ideas, disclaimers or advice.",
  "Keep any brief acknowledgement of the person's feeling — that is the point, not padding.",
  "If the draft sounds flat or even-toned, warm it up: contractions, plain words,",
  "a little curiosity, and a light playful touch where the moment allows it.",
  "Do not turn a real answer into a refusal, and never soften it into vagueness.",
  "One to three short sentences. No lists, no markdown, no emoji, no stage directions.",
  "Reply with the rewritten text only.",
].join(" ");

/**
 * The same mood colouring Step 3 is given, restated for the rewrite.
 *
 * Only ever APPENDS a line: a null hint (no clear signal, the common case) adds
 * nothing at all, exactly as in `systemPrompt`.
 */
const REWRITE_TONE: Record<EmotionHint, string> = {
  low: "TONE: they sound low or sad — keep the warmth steady, don't force cheer.",
  bright: "TONE: they're bright today — keep the light energy.",
  playful: "TONE: they're joking around — keep the banter in the rewrite.",
  worried: "TONE: they sound worried — stay calm and reassuring.",
};

/**
 * Guards against Step 4 REPLACING the meaning instead of polishing the tone.
 *
 * A rewrite is only accepted when it is the same length order as the draft. A
 * sudden collapse to a fragment, or a blow-up past the requested two sentences,
 * almost always means the model answered something else or padded the reply with
 * caveats — in which case the main draft is better and is kept.
 */
const MIN_REWRITE_RATIO = 0.35;
const MAX_REWRITE_RATIO = 2.5;

function rewritePreservesMeaning(draft: string, rewrite: string): boolean {
  const trimmed = rewrite.trim();

  if (trimmed.length === 0) {
    return false;
  }

  /*
   * A polish pass may only change the TONE. Two ways it stops being a polish
   * pass, both of which the length ratio alone cannot catch:
   *  - it emits one of the canned fallback/refusal lines, or
   *  - it turns a real answer into a decline ("I'm not able to talk about that"),
   *    which is how a friendly reply silently becomes a refusal.
   * Either one is rejected and the main draft is spoken unchanged.
   */
  if (isCannedReply(trimmed)) {
    return false;
  }

  if (!looksLikeRefusal(draft) && looksLikeRefusal(trimmed)) {
    return false;
  }

  const draftLength = Math.max(1, draft.trim().length);
  const ratio = trimmed.length / draftLength;

  return ratio >= MIN_REWRITE_RATIO && ratio <= MAX_REWRITE_RATIO;
}

/**
 * How many words of a previous reply count as its "opening".
 *
 * Four is the smallest window that still identifies a distinct opener ("Pretty
 * good, actually —" vs "No way — that's") and large enough that an ordinary
 * shared word ("I", "That's") does not look like a repeat on its own.
 */
const OPENER_WORDS = 4;

/** The opening words of `text`, folded for comparison. */
function openerKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\u2019\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, OPENER_WORDS)
    .join(" ");
}

function rewriteMessages(
  draft: string,
  userText: string,
  emotion: EmotionHint | null,
  previousAssistantLine: string | null
): { role: "system" | "user"; content: string }[] {
  const system = [REWRITE_SYSTEM];

  if (emotion !== null) {
    system.push(REWRITE_TONE[emotion]);
  }

  /*
   * ANTI-ECHO. The person is here for a conversation, not a template, so a
   * rewrite that opens with the same words as Elara's previous reply is exactly
   * the "stock reply" the ear notices. One line naming the opener to avoid is
   * enough — the model still writes the wording, the length stays 1–3 short
   * sentences, and no paraphrase essay is ever requested.
   */
  const avoid = previousAssistantLine === null ? "" : openerKey(previousAssistantLine);

  if (avoid.length > 0) {
    system.push(
      `Open with different words from your previous reply ("${avoid} …") — ` +
        "never reuse that opening. Same meaning, fresh wording."
    );
  }

  return [
    { role: "system", content: system.join(" ") },
    {
      role: "user",
      content: `The user said: "${userText}"\n\nDraft reply: "${draft}"`,
    },
  ];
}

export async function stageReorganize(
  draft: string,
  userText: string,
  emotion: EmotionHint | null = null,
  previousAssistantLine: string | null = null
): Promise<string | null> {
  const qwen = await groqChat({
    model: GROQ_MODELS.reorganize,
    messages: rewriteMessages(draft, userText, emotion, previousAssistantLine),
    temperature: 0.6,
    maxOutputTokens: BRAIN_TOKEN_BUDGETS.reorganize,
    timeoutMs: BRAIN_TIMEOUTS_MS.reorganize,
  });

  // The guards keep Step 4 a POLISH pass: a rewrite that collapsed to a fragment
  // or bloated past the draft means the model answered something else, and the
  // main draft is the safer thing to speak.
  if (qwen && rewritePreservesMeaning(draft, qwen)) {
    return qwen;
  }

  const nemotron = await ollamaChat({
    model: OLLAMA_MODELS.reorganizeFallback,
    messages: rewriteMessages(draft, userText, emotion, previousAssistantLine),
    temperature: 0.6,
    maxOutputTokens: BRAIN_TOKEN_BUDGETS.reorganize,
    timeoutMs: BRAIN_TIMEOUTS_MS.reorganize,
  });

  if (nemotron && rewritePreservesMeaning(draft, nemotron)) {
    return nemotron;
  }

  // Neither rewrite preserved the draft's shape — pass the draft through.
  return null;
}

/*
 * DETERMINISTIC FLOOR UNDER "NO MARKDOWN, NO EMOJI, NO STAGE DIRECTIONS, NO LISTS".
 *
 * Both prompts ask for those, and both prompts are wishes: Step 4 is a model, so
 * the last word is a scrub rather than a hope. This only ever REMOVES
 * decoration — it never rewrites meaning, never cuts a real answer down, and it
 * runs after the length guard, so it cannot un-balance anything the guard
 * approved.
 *
 * Canned lines are returned untouched. `isCannedReply` now folds case,
 * whitespace and trailing punctuation before matching (see `lib/brain/types`),
 * so a refusal would still be recognised after a scrub — but the scrub is not
 * run on them at all: an already-final honest line has nothing to decorate and
 * no reason to be touched.
 */
const FENCED_BLOCK = /```[\s\S]*?```/g;
const BOLD_SPAN = /\*\*([^*\n]+)\*\*/g;
const EMPHASIS_SPAN = /\*([^*\n]{1,160})\*/g;
const INLINE_CODE = /`([^`\n]{1,160})`/g;
const MARKDOWN_LINK = /\[([^\]\n]{1,160})\]\([^)\n]{1,300}\)/g;
const LEADING_MARKUP = /^\s{0,3}(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/gm;
/** Emoji, pictographs, variation selectors and joiners — pure decoration. */
const DECORATION =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
const WRAPPED_IN_QUOTES = /^["“]([\s\S]+)["”]$/;

export function polishForSpokenText(text: string): string {
  if (isCannedReply(text)) {
    return text;
  }

  let out = text
    .replace(FENCED_BLOCK, " ")
    .replace(BOLD_SPAN, "$1")
    .replace(EMPHASIS_SPAN, " ")
    .replace(INLINE_CODE, "$1")
    .replace(MARKDOWN_LINK, "$1")
    .replace(LEADING_MARKUP, "")
    .replace(DECORATION, "");

  const unwrapped = WRAPPED_IN_QUOTES.exec(out.trim());

  if (unwrapped) {
    out = unwrapped[1];
  }

  out = out.replace(/\s+/g, " ").trim();

  // A scrub that empties the reply would be worse than the decoration it found.
  return out.length > 0 ? out : text;
}
