/**
 * Shared voice types.
 *
 * The six status states below are the complete state machine for the Day-1
 * voice loop. Keeping them as a closed union means every UI surface that
 * renders voice state must handle all six.
 */
export type VoiceStatus =
  /** Mic off, no session. */
  | "idle"
  /** Mic permission, token, and socket handshake in progress. */
  | "connecting"
  /** Mic live, audio streaming to AssemblyAI. */
  | "listening"
  /** Final transcript received; reply is being prepared (stub for now). */
  | "thinking"
  /** SpeechSynthesis is reading the reply aloud. */
  | "speaking"
  /** Anything went wrong — message explains what. */
  | "error";

/**
 * Languages the voice UI can offer. See `lib/voice/languages.ts`.
 *
 * SINGLE SOURCE OF TRUTH for the accepted language set — the brain's
 * `ReplyLanguage` is derived from this union, so STT routing, the Language
 * Locker, the brain's language directive and the TTS tag can never drift apart.
 *
 *   en                     Universal-3.5 Pro Realtime (AssemblyAI)
 *   es fr de it pt ar da   Universal-3.5 Pro Realtime (AssemblyAI)
 *   nl fi he hi ja zh no   Universal-3.5 Pro Realtime (AssemblyAI)
 *   sv tr vi               Universal-3.5 Pro Realtime (AssemblyAI)
 *   bn                     Browser Web Speech fallback (no AssemblyAI real-time
 *                          Bengali model exists — verified against live docs)
 *   ca                     Browser Web Speech fallback (outside the verified
 *                          18-language Universal set — "+ ca if supported")
 */
export const VOICE_LANGUAGE_CODES = [
  "en",
  "bn",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ar",
  "da",
  "nl",
  "fi",
  "he",
  "hi",
  "ja",
  "zh",
  "no",
  "sv",
  "tr",
  "vi",
  "ca",
] as const;

export type VoiceLanguageCode = (typeof VOICE_LANGUAGE_CODES)[number];

/**
 * Runtime guard for the accepted set — used by the brain route to validate
 * the client's language tag before it reaches any model. Anything unknown
 * falls back to English; the server never guesses a language from text.
 */
export function isVoiceLanguageCode(value: unknown): value is VoiceLanguageCode {
  return (
    typeof value === "string" &&
    (VOICE_LANGUAGE_CODES as readonly string[]).includes(value)
  );
}

/** A single line in the on-screen transcript. */
export interface TranscriptTurn {
  id: string;
  speaker: "you" | "elara";
  text: string;
  /** False while the turn is still being revised by the STT stream. */
  isFinal: boolean;
}

/* ──────────────────────────────────────────────────────────────────────────
   AssemblyAI v3 streaming WebSocket messages (server → client).

   Only the fields we actually consume are typed. Everything is optional-safe
   because the stream can add fields without notice.
   ────────────────────────────────────────────────────────────────────────── */

export interface AssemblyAiBeginMessage {
  type: "Begin";
  id: string;
  expires_at?: number;
}

export interface AssemblyAiSpeechStartedMessage {
  type: "SpeechStarted";
  timestamp: number;
  confidence?: number;
}

export interface AssemblyAiTurnMessage {
  type: "Turn";
  turn_order: number;
  transcript: string;
  /** True once AssemblyAI has finalized this turn. */
  end_of_turn: boolean;
  turn_is_formatted?: boolean;
  end_of_turn_confidence?: number;
  /**
   * The language AssemblyAI reports for this turn ("es", "pt-BR", …).
   *
   * Present only when the connection enabled `language_detection` and the
   * model supports it. Reporting only — it never changes the transcription.
   * Evidence, not instruction: the lock ranks it below an explicit request
   * and below script evidence (see `handleFinalTurn`).
   */
  language_code?: string;
  /** 0–1 confidence behind `language_code`. */
  language_confidence?: number;
}

export interface AssemblyAiTerminationMessage {
  type: "Termination";
  audio_duration_seconds?: number;
  session_duration_seconds?: number;
}

export interface AssemblyAiHeartbeatMessage {
  type: "Heartbeat";
  total_audio_received_ms?: number;
}

/** Documented error frame (shape varies, so this is tolerant). */
export interface AssemblyAiErrorMessage {
  type: "Error";
  error?: string;
  message?: string;
}

export type AssemblyAiServerMessage =
  | AssemblyAiBeginMessage
  | AssemblyAiSpeechStartedMessage
  | AssemblyAiTurnMessage
  | AssemblyAiTerminationMessage
  | AssemblyAiHeartbeatMessage
  | AssemblyAiErrorMessage
  | { type: string };