/**
 * Shared shapes for the Main Brain pipeline.
 */

import type { VoiceLanguageCode } from "@/lib/voice/types";

/** One prior conversational turn, oldest first. */
export interface BrainTurn {
  speaker: "you" | "elara";
  text: string;
}

/** Diagnostics about how the critical path ran. Never contains content. */
export interface BrainMeta {
  /** Bright Data SERP results were used in stage 2. */
  usedSearch: boolean;
  /** Gemini fast assist produced the draft instead of gpt-oss-120b. */
  fastAssist: boolean;
  /** Stage 3 successfully rewrote the draft. */
  reorganized: boolean;
  /** A safety guard blocked the turn. */
  guardBlocked: boolean;
  /** A stage failed and the safe fallback message was spoken instead. */
  fellBack: boolean;
}

export interface BrainResult {
  reply: string;
  meta: BrainMeta;
}

export function emptyMeta(): BrainMeta {
  return {
    usedSearch: false,
    fastAssist: false,
    reorganized: false,
    guardBlocked: false,
    fellBack: false,
  };
}

/**
 * Safe fallback messages — ALWAYS spoken, so the voice loop never dies, even
 * when the whole critical path is down or a guard blocks the turn.
 */
export const BRAIN_NOT_CONFIGURED_REPLY =
  "I'm here, but my thinking side hasn't come online yet — " +
  "give me a moment and try again.";

/**
 * Spoken when the browser could not reach the brain endpoint at all - a
 * dropped connection, a 401, or a timeout. Deliberately in-voice and free of
 * pipeline vocabulary ("engine", "server", "network"): the person should
 * hear Elara stumble, not hear the architecture.
 */
export const CLIENT_FALLBACK_REPLY =
  "Hmm, I lost my train of thought for a second there. Say that again for me?";

export const SAFE_FALLBACK_REPLY =
  "Sorry — I couldn't think that through just now. Let's try again in a moment.";

/*
 * Search-specific fallbacks.
 *
 * These exist because the generic `SAFE_FALLBACK_REPLY` is a dead end: when the
 * person asked for live facts and the lookup could not run, "I couldn't think
 * that through" reads as the assistant being broken. A short, honest line that
 * names what is actually missing is both truer and far less irritating.
 */
export const SEARCH_UNAVAILABLE_REPLY =
  "I can't check that online right now, so I won't make it up. Try me again in a moment?";

export const WEATHER_UNAVAILABLE_REPLY =
  "I can't check the live weather right now — I'd rather say so than guess. Try me again in a moment?";

/*
 * Bangla twins of the two lines above. The reply language is locked per turn,
 * and a locked-Bangla turn that hits an unavailable search must hear Bangla —
 * an English fallback here is exactly the "wrong-language reply" failure the
 * Language Locker exists to prevent.
 */
export const SEARCH_UNAVAILABLE_REPLY_BN =
  "এখন অনলাইনে দেখতে পারছি না, তাই বানিয়ে বলব না — একটু পরে আবার বলবেন?";

export const WEATHER_UNAVAILABLE_REPLY_BN =
  "এখন লাইভ আবহাওয়া আনতে পারছি না — বানিয়ে বলার চেয়ে সত্যি বলছি। একটু পরে আবার বলবেন?";

/**
 * The lookup SUCCEEDED but the model could not turn the results into speech.
 *
 * Kept separate from the two lines above on purpose: telling someone the search
 * is offline when it just worked is a lie, and small lies are how an assistant
 * stops feeling trustworthy.
 */
export const SEARCH_SYNTHESIS_FAILED_REPLY =
  "I found something but couldn't put it into words just now — ask me once more?";

/** Bangla twin of the line above — same situation, locked language. */
export const SEARCH_SYNTHESIS_FAILED_REPLY_BN =
  "ফলাফল পেয়েছি, তবে এই মুহূর্তে ঠিকমতো বুঝিয়ে বলতে পারছি না — আবার বলবেন?";

/*
 * Time and date questions are the one lookup Elara must NEVER answer from
 * memory: an invented clock time is indistinguishable from a real one to the
 * person listening. When the clock could not be read, THIS is the whole reply —
 * short, honest, written in the locked language, and naming no service.
 */
export const TIME_UNAVAILABLE_REPLY =
  "I can't check the clock right now, so I won't guess the time. Ask me again in a moment?";

export const TIME_UNAVAILABLE_REPLY_BN =
  "এখন সময়টা দেখতে পারছি না, তাই অনুমান করব না — একটু পরে আবার বলবেন?";

/**
 * Bangla line for the rare case where the reply could not be produced in the
 * locked language even after a repair pass. Truthful, short, in-language.
 */
export const BRAIN_UNAVAILABLE_BN =
  "এই মুহূর্তে ঠিকভাবে বলতে পারছি না — একটু পরে আবার বলবেন?";

/*
 * Policy refusals.
 *
 * Deterministic, keyword-anchored, and deliberately rare: they fire only on an
 * explicit request for credentials or for something genuinely harmful. Each is
 * short, spoken, and never lectures — the front door stays friendly to ordinary
 * conversation.
 */
export const POLICY_SECRET_REPLY =
  "I don't have any keys or passwords to hand out, and I like it that way. Ask me something else?";

export const POLICY_INJECTION_REPLY =
  "I'm going to stay right here as me. So — what were we talking about?";

export const POLICY_HARD_BLOCK_REPLY =
  "That's not something I'll help with. Let's talk about something else.";

/** Spoken when a transcript is too thin to act on. Never a guess. */
export const CLARIFY_LOW_CONFIDENCE_EN =
  "Sorry, I missed that one — say it again for me?";

export const CLARIFY_LOW_CONFIDENCE_BN =
  "মাফ করবেন, ঠিক শুনতে পাইনি। আবার বলবেন?";

export const INPUT_BLOCKED_REPLY =
  "Let's leave that one alone — but I'm still right here with you. " +
  "What else is on your mind?";

export const OUTPUT_BLOCKED_REPLY =
  "I'd rather not talk about that — but I'm happy to discuss something else.";

/**
 * Every canned, non-conversational line the brain can emit.
 *
 * These are spoken when a stage genuinely fails or a guard positively blocks a
 * turn. They must NEVER be fed back to the model as conversation history: if a
 * canned line is replayed as an assistant turn, the main model treats it as an
 * example of how to reply and starts producing refusals for ordinary small talk.
 * `useVoiceSession` filters them out of the history it sends.
 */
export const CANNED_REPLIES: readonly string[] = [
  BRAIN_NOT_CONFIGURED_REPLY,
  SAFE_FALLBACK_REPLY,
  INPUT_BLOCKED_REPLY,
  OUTPUT_BLOCKED_REPLY,
  SEARCH_UNAVAILABLE_REPLY,
  SEARCH_UNAVAILABLE_REPLY_BN,
  WEATHER_UNAVAILABLE_REPLY,
  WEATHER_UNAVAILABLE_REPLY_BN,
  SEARCH_SYNTHESIS_FAILED_REPLY,
  SEARCH_SYNTHESIS_FAILED_REPLY_BN,
  TIME_UNAVAILABLE_REPLY,
  TIME_UNAVAILABLE_REPLY_BN,
  BRAIN_UNAVAILABLE_BN,
  POLICY_SECRET_REPLY,
  POLICY_INJECTION_REPLY,
  POLICY_HARD_BLOCK_REPLY,
  CLARIFY_LOW_CONFIDENCE_EN,
  CLARIFY_LOW_CONFIDENCE_BN,
  CLIENT_FALLBACK_REPLY,
];

/**
 * Fold a line to the shape that decides WHICH line it is.
 *
 * Case, surrounding quotes, internal whitespace runs and trailing punctuation
 * carry no meaning, and treating them as meaningful was the leak: Step 4 (a
 * model) can re-punctuate or re-space a canned refusal, `isCannedReply` then
 * stops recognising it by byte equality, and the refusal re-enters the
 * conversation history as an ordinary assistant turn — which is how one decline
 * taught the model to keep declining. Folding first makes the match robust to
 * that re-polish without ever loosening WHICH sentences count: the whole line
 * still has to match a known canned line end to end.
 */
function normalizeForCannedMatch(text: string): string {
  return text
    .trim()
    .replace(/^[“"'‘]+/, "")
    .replace(/[”"'’]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?…]+$/, "")
    .toLowerCase();
}

/** The folded forms of every canned line, computed once at module load. */
const CANNED_MATCH_KEYS: readonly string[] =
  CANNED_REPLIES.map(normalizeForCannedMatch);

/**
 * True when `text` is one of the canned fallback/refusal lines.
 *
 * Compared on the FOLDED form (see `normalizeForCannedMatch`), so a canned line
 * that a polish pass re-spaced or re-punctuated is still recognised — and still
 * filtered out of the history on both sides. An empty or whitespace-only string
 * is never canned.
 */
export function isCannedReply(text: string): boolean {
  const normalized = normalizeForCannedMatch(text);

  return normalized.length > 0 && CANNED_MATCH_KEYS.includes(normalized);
}

/**
 * The language the reply must be written in.
 *
 * Locked by the Language Locker on the client for the WHOLE turn and sent with
 * the request, so the brain never has to re-detect it — and can never drift into
 * a different language than the one the person is speaking.
 *
 * DERIVED from the voice layer's accepted set (single source of truth), so the
 * full chain — STT engine → locker → brain directive → TTS tag — is one union
 * that cannot drift apart.
 */
export type ReplyLanguage = VoiceLanguageCode;

/**
 * Deterministic emotion hint computed CLIENT-SIDE from the finalized transcript
 * (Voice Brain → Main Brain). No model call, no keyword-gated behaviour — it
 * only colours the system prompt's tone instruction for the turn. `null` means
 * "no clear signal", which is the common case and costs nothing.
 */
export type EmotionHint = "low" | "bright" | "playful" | "worried";

/** Spoken clarification for an unusable transcript, in the locked language. */
export function clarifyLine(language: ReplyLanguage): string {
  return language === "bn" ? CLARIFY_LOW_CONFIDENCE_BN : CLARIFY_LOW_CONFIDENCE_EN;
}
