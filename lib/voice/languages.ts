import type { VoiceLanguageCode } from "@/lib/voice/types";

/**
 * The language lock, modelled by CAPABILITY rather than hardcoded model ids.
 *
 * This is deliberate. AssemblyAI's real-time (streaming) models and its
 * pre-recorded models support very different language sets, so a language is
 * described by *what it can do today* plus the model that would serve it. That
 * way adding Bangla later is a data change here, not a refactor.
 *
 * Verified against AssemblyAI's live docs (2026-09):
 *   - Streaming: Universal-3.5 Pro Streaming → 18 languages (no Bengali),
 *     Universal-Streaming Multilingual → en/es/pt/de/fr/it,
 *     Universal-Streaming English → English.
 *   - Pre-recorded: Universal-2 → 99 languages, which DOES include Bengali,
 *     but in the lowest accuracy bucket (>50% WER).
 *   - There is no Whisper streaming model on the platform.
 */
export interface VoiceLanguage {
  code: VoiceLanguageCode;
  /** Native-script label, shown in the picker. */
  label: string;
  /** English name, used in accessible labels. */
  englishLabel: string;
  /** Can this language drive a live, real-time session today? */
  streaming: boolean;
  /** AssemblyAI streaming model id — present only when `streaming` is true. */
  streamingModel?: string;
  /** Pre-recorded model that would serve this language off the critical path. */
  preRecordedModel?: string;
  /** BCP-47 tag for SpeechSynthesis voice matching. */
  ttsLang: string;
  /**
   * The browser's own Web Speech recognizer can handle this language.
   *
   * Only consulted when AssemblyAI has no real-time model for the language —
   * see `resolveSttEngine`. English never uses it.
   */
  browserStt?: boolean;
  /** Shown in the UI when `streaming` is false. Must be honest and specific. */
  unavailableReason?: string;
}

export const DEFAULT_VOICE_LANGUAGE: VoiceLanguageCode = "en";

export const VOICE_LANGUAGES: readonly VoiceLanguage[] = [
  {
    code: "en",
    label: "English",
    englishLabel: "English",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "en-US",
  },
  {
    /*
     * Bengali has NO AssemblyAI real-time model, verified against the live docs
     * (2026-09): Universal-3.5 Pro Streaming covers 18 languages and
     * Universal-Streaming Multilingual covers six — Bengali is in neither, and
     * `language_code` applies to pre-recorded audio only.
     *
     * Sending Bangla audio to a multilingual streaming model is precisely the
     * live bug this replaces: the model maps Bengali phonetics onto the nearest
     * language it knows (Italian and Spanish are the usual results) and Elara
     * answers in that wrong language. The locked Voice Brain already names the
     * correct route for exactly this case — "Fallback → Browser Web Speech API".
     * Bangla therefore runs on the browser recognizer (`browserStt`), while
     * every language AssemblyAI CAN serve stays on AssemblyAI.
     */
    code: "bn",
    label: "বাংলা",
    englishLabel: "Bengali",
    streaming: false,
    preRecordedModel: "universal-2",
    browserStt: true,
    ttsLang: "bn-BD",
    unavailableReason:
      "Bangla uses your browser's own recognizer — AssemblyAI has no real-time Bengali model yet.",
  },
  /* ── Universal-3.5 Pro Realtime set (the locked ~18-language architecture). ──
     One entry per accepted language; all served by AssemblyAI's Universal-3.5
     Pro streaming model, which is the STT mother for this tier. The demo
     priority is en + bn flawless; these are structurally enabled end-to-end
     (STT engine → locker → brain directive → TTS tag) so choosing one opens a
     real session on the first try. */
  {
    code: "es",
    label: "Español",
    englishLabel: "Spanish",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "es-ES",
  },
  {
    code: "fr",
    label: "Français",
    englishLabel: "French",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "fr-FR",
  },
  {
    code: "de",
    label: "Deutsch",
    englishLabel: "German",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "de-DE",
  },
  {
    code: "it",
    label: "Italiano",
    englishLabel: "Italian",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "it-IT",
  },
  {
    code: "pt",
    label: "Português",
    englishLabel: "Portuguese",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "pt-BR",
  },
  {
    code: "ar",
    label: "العربية",
    englishLabel: "Arabic",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "ar-SA",
  },
  {
    code: "da",
    label: "Dansk",
    englishLabel: "Danish",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "da-DK",
  },
  {
    code: "nl",
    label: "Nederlands",
    englishLabel: "Dutch",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "nl-NL",
  },
  {
    code: "fi",
    label: "Suomi",
    englishLabel: "Finnish",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "fi-FI",
  },
  {
    code: "he",
    label: "עברית",
    englishLabel: "Hebrew",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "he-IL",
  },
  {
    code: "hi",
    label: "हिन्दी",
    englishLabel: "Hindi",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "hi-IN",
  },
  {
    code: "ja",
    label: "日本語",
    englishLabel: "Japanese",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "ja-JP",
  },
  {
    code: "zh",
    label: "中文",
    englishLabel: "Chinese",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "zh-CN",
  },
  {
    code: "no",
    label: "Norsk",
    englishLabel: "Norwegian",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "nb-NO",
  },
  {
    code: "sv",
    label: "Svenska",
    englishLabel: "Swedish",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "sv-SE",
  },
  {
    code: "tr",
    label: "Türkçe",
    englishLabel: "Turkish",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "tr-TR",
  },
  {
    code: "vi",
    label: "Tiếng Việt",
    englishLabel: "Vietnamese",
    streaming: true,
    streamingModel: "universal-3-5-pro",
    ttsLang: "vi-VN",
  },
  {
    /*
     * Catalan sits OUTSIDE the verified 18-language Universal-3.5 Pro set, so
     * it follows the same honest route as Bangla: the browser's own recognizer.
     * Structurally enabled ("+ ca if supported") without claiming an AssemblyAI
     * capability that was never verified.
     */
    code: "ca",
    label: "Català",
    englishLabel: "Catalan",
    streaming: false,
    browserStt: true,
    ttsLang: "ca-ES",
    unavailableReason:
      "Catalan uses your browser's own recognizer — outside the verified real-time model set.",
  },
] as const;

/** Look up a language definition by code. */
export function getVoiceLanguage(code: VoiceLanguageCode): VoiceLanguage {
  const language = VOICE_LANGUAGES.find((entry) => entry.code === code);

  if (!language) {
    throw new Error(`Unsupported voice language: ${code}`);
  }

  return language;
}

/**
 * Resolve the streaming model for a language.
 *
 * Throws if the language has no real-time model, so an unsupported language can
 * never silently open a session that AssemblyAI would reject.
 */
export function getStreamingModel(code: VoiceLanguageCode): string | null {
  const language = getVoiceLanguage(code);

  // Bangla (and any future non-streaming language) has NO real-time model —
  // return null so the caller can route to the browser fallback instead of
  // throwing and killing the voice session. Never silently open a session that
  // AssemblyAI would reject: null is an explicit "route elsewhere" signal.
  if (!language.streaming || !language.streamingModel) {
    return null;
  }

  return language.streamingModel;
}

/** Languages that can start a live session right now. */
export function getStreamingLanguages(): VoiceLanguage[] {
  return VOICE_LANGUAGES.filter((language) => language.streaming);
}

/** Which recognizer serves a locked language. */
export type VoiceSttEngine = "assemblyai" | "browser";

/**
 * Resolve the speech-recognition engine for a locked language.
 *
 * Order is deliberate and non-negotiable: AssemblyAI is the STT mother, so any
 * language with a real-time AssemblyAI model uses it. The browser recognizer is
 * the fallback the locked Voice Brain already names, and it is reached ONLY for
 * a language AssemblyAI genuinely cannot serve (today: Bangla). Without this,
 * Bangla audio went to a multilingual model that mapped it onto an unrelated
 * language — the wrong-language transcript bug.
 *
 * Throws when a language has neither path, so a session can never open on a
 * recognizer that would silently produce nonsense.
 */
/**
 * Which recognizer serves a locked language, or `null` when none does.
 *
 * The non-throwing twin of `resolveSttEngine`, for callers inside the live loop:
 * the lock is validated against the accepted set, so `null` is unreachable in
 * practice — but a voice session that dies on an unreachable branch is worse
 * than one that simply keeps listening.
 */
export function sttEngineFor(
  code: VoiceLanguageCode
): VoiceSttEngine | null {
  const language = getVoiceLanguage(code);

  if (language.streaming && language.streamingModel) {
    return "assemblyai";
  }

  return language.browserStt ? "browser" : null;
}

export function resolveSttEngine(code: VoiceLanguageCode): VoiceSttEngine {
  const engine = sttEngineFor(code);

  if (engine === null) {
    throw new Error(`No speech-recognition path exists for language "${code}".`);
  }

  return engine;
}