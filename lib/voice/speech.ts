"use client";

import type { EmotionHint } from "@/lib/brain/types";

/**
 * Browser SpeechSynthesis wrapper — the TTS half of the voice loop.
 *
 * Deliberately uses only the platform API: no external TTS service, no API key,
 * nothing to pay for, and audio never leaves the machine on the way out.
 *
 * Caveats handled here:
 * - Voice lists load asynchronously, so we resolve the voice at speak() time.
 * - `speak()` never rejects, so we listen for `end`/`error` to know when to
 *   return to Idle — otherwise the UI would stay stuck on "Speaking".
 * - `cancel()` is called before each utterance so overlapping replies never
 *   stack up (a real risk if a user speaks again while Elara is talking).
 */

export interface SpeakOptions {
  text: string;
  /** BCP-47 tag from the language lock, e.g. `en-US`. */
  lang: string;
  rate?: number;
  pitch?: number;
  /**
   * Emotion hint for the turn. When present it sets the voice prosody, so the
   * feeling is audible and not only written. Explicit rate/pitch always win.
   */
  emotion?: EmotionHint | null;
}

/** Whether this browser can speak at all. */
export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/**
 * Waits briefly for the platform voice list to populate.
 *
 * Chromium exposes `getVoices()` as empty until `voiceschanged` fires, and on
 * some platforms it never fires at all — so this always resolves.
 */
function waitForVoices(timeoutMs = 1000): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }

    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

/**
 * Pick the best available voice for a language tag, preferring local voices.
 *
 * "matched" is the honest half of the result: when the device has NO voice for
 * the language, the voice is null and matched is false. The caller can then say
 * so out loud instead of letting the platform pick a voice that cannot
 * pronounce the text - the behaviour behind "Bangla text appears but nothing is
 * spoken".
 */
function resolveVoice(
  voices: SpeechSynthesisVoice[],
  lang: string
): { voice: SpeechSynthesisVoice | null; matched: boolean } {
  if (voices.length === 0) {
    return { voice: null, matched: false };
  }

  const normalised = lang.toLowerCase();
  const language = normalised.split("-")[0];

  // Exact tag match first (e.g. "en-US"), then any voice for the language.
  const exact = voices.filter(
    (voice) => voice.lang.toLowerCase().replace("_", "-") === normalised
  );
  const sameLanguage = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(language)
  );

  const candidates = exact.length > 0 ? exact : sameLanguage;

  // Offline voices are more reliable (no network round-trip mid-sentence).
  const voice =
    candidates.find((entry) => entry.localService) ?? candidates[0] ?? null;

  return { voice, matched: candidates.length > 0 };
}

/**
 * Whether this device can actually pronounce a language tag.
 *
 * The console asks this so it can be honest about a missing voice BEFORE
 * anything is spoken. It awaits the platform voice list exactly the way
 * speak() does, so the two can never disagree about what is available.
 */
export async function hasVoiceForLanguage(lang: string): Promise<boolean> {
  if (!isSpeechSynthesisSupported()) {
    return false;
  }

  const voices = await waitForVoices();
  return resolveVoice(voices, lang).matched;
}

/** Stops anything currently being spoken. Safe to call at any time. */
export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Emotion hint -> voice prosody.
 *
 * The hint already colours the WORDS (the brain's system prompt sees it); this
 * is the same hint colouring the VOICE. Without it every reply - happy, sad or
 * playful - came out at rate 1 / pitch 1, which is exactly why she sounded flat
 * and machine-like no matter what she said. Small, deliberate deltas: enough to
 * hear, never a caricature.
 */
const EMOTION_PROSODY: Record<EmotionHint, { rate: number; pitch: number }> = {
  low: { rate: 0.93, pitch: 0.95 },
  worried: { rate: 0.97, pitch: 1 },
  bright: { rate: 1.06, pitch: 1.08 },
  playful: { rate: 1.05, pitch: 1.12 },
};

/**
 * Split a reply into speakable sentences.
 *
 * Speaking one long utterance makes every reply land in the same flat run. Two
 * short utterances with a breath between them is how a person actually talks.
 * Capped at two chunks so a long reply never turns into a monologue.
 */
function splitForSpeech(text: string): string[] {
  const trimmed = text.trim();
  const sentences = trimmed.match(/[^.!?]+[.!?]*/g);

  if (!sentences) {
    return [trimmed];
  }

  const chunks = sentences.map((sentence) => sentence.trim()).filter(Boolean);

  if (chunks.length === 0) {
    return [trimmed];
  }

  if (chunks.length <= 2) {
    return chunks;
  }

  return [chunks[0], chunks.slice(1).join(" ")];
}

/** One utterance, resolved when playback ends (or fails). Never rejects. */
function utter(
  synthesis: SpeechSynthesis,
  options: {
    text: string;
    lang: string;
    voice: SpeechSynthesisVoice | null;
    rate: number;
    pitch: number;
  }
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.lang = options.lang;
    utterance.rate = options.rate;
    utterance.pitch = options.pitch;

    if (options.voice) {
      utterance.voice = options.voice;
    }

    utterance.onend = finish;
    utterance.onerror = finish;

    try {
      synthesis.speak(utterance);
    } catch {
      finish();
    }
  });
}

/**
 * Speaks a reply and resolves when playback finishes (or fails).
 *
 * Never throws: a TTS failure must not break the conversation loop, so the
 * caller can always return to Idle. A missing voice for the language is not a
 * failure either - the platform default reads the text as best it can, and the
 * console tells the person that the voice is missing instead of failing
 * silently.
 */
export async function speak({
  text,
  lang,
  rate,
  pitch,
  emotion = null,
}: SpeakOptions): Promise<void> {
  if (!isSpeechSynthesisSupported() || text.trim().length === 0) {
    return;
  }

  const synthesis = window.speechSynthesis;

  // Never let two replies overlap.
  synthesis.cancel();

  const voices = await waitForVoices();
  const resolved = resolveVoice(voices, lang);
  const prosody = emotion === null ? null : EMOTION_PROSODY[emotion];
  const resolvedRate = rate ?? prosody?.rate ?? 1;
  const resolvedPitch = pitch ?? prosody?.pitch ?? 1;

  for (const chunk of splitForSpeech(text)) {
    await utter(synthesis, {
      text: chunk,
      lang,
      voice: resolved.voice,
      rate: resolvedRate,
      pitch: resolvedPitch,
    });
  }
}
