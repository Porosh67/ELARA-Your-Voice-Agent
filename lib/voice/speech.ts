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
 * HOW LONG A SPEECH ATTEMPT MAY WAIT FOR THE VOICE LIST.
 *
 * Long enough for a cold platform list to land, short enough that a reply is
 * never held back by it. `warmupVoices()` is what makes this cap safe: the list
 * is normally already cached before the first reply exists.
 */
const VOICE_WAIT_MS = 300;

/**
 * THE CACHED VOICE LIST — warmed once, refreshed on `voiceschanged`.
 *
 * Chromium exposes `getVoices()` as empty until `voiceschanged` fires, so an
 * earlier version awaited the list on EVERY reply — up to a second of silence
 * between "thinking" and the first word, on every single turn. The list is a
 * property of the device, not of the reply, so it is read once (as early as the
 * voice console mounts) and re-read whenever the platform says it changed.
 */
let cachedVoices: SpeechSynthesisVoice[] | null = null;
/** True once a `voiceschanged` listener has been attached, so it is never doubled. */
let listeningForVoices = false;
/** Language tag → resolved voice + match result. Cleared whenever the list changes. */
const resolvedVoiceCache = new Map<
  string,
  { voice: SpeechSynthesisVoice | null; matched: boolean }
>();

/** Read the platform list, storing it when the platform actually has entries. */
function readVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) {
    return [];
  }

  const voices = window.speechSynthesis.getVoices();

  if (voices.length > 0) {
    cachedVoices = voices;
  }

  return voices;
}

/**
 * Warm the voice list BEFORE the first reply needs it.
 *
 * Safe to call at any time, from anywhere, as often as you like: it never
 * throws, never speaks, and never waits. Called when the voice console mounts
 * and when a session starts, so the cost is paid while the person is still
 * deciding to talk instead of after Elara has something to say.
 */
export function warmupVoices(): void {
  if (!isSpeechSynthesisSupported()) {
    return;
  }

  if (readVoices().length > 0) {
    return;
  }

  if (listeningForVoices) {
    return;
  }

  listeningForVoices = true;

  window.speechSynthesis.addEventListener("voiceschanged", () => {
    // A new list invalidates every resolved language → voice decision.
    resolvedVoiceCache.clear();
    readVoices();
  });
}

/**
 * Waits briefly for the platform voice list to populate.
 *
 * Resolves immediately from the cache when it is warm; otherwise waits for
 * `voiceschanged` (or the timeout) exactly as before. Always resolves, because
 * on some platforms the event never fires at all.
 */
function waitForVoices(timeoutMs = VOICE_WAIT_MS): Promise<SpeechSynthesisVoice[]> {
  const cached = cachedVoices;

  if (cached !== null && cached.length > 0) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve) => {
    const existing = readVoices();
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
      resolve(readVoices());
    };

    window.speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

/**
 * The list to resolve a voice against, without an open-ended wait.
 *
 * `speak()` uses this: a warm cache means no wait at all, and a cold one means
 * one bounded wait — never the full second the old first-reply path paid.
 */
async function voicesForSpeech(): Promise<SpeechSynthesisVoice[]> {
  const cached = cachedVoices;

  if (cached !== null && cached.length > 0) {
    return cached;
  }

  return waitForVoices(VOICE_WAIT_MS);
}

/**
 * `resolveVoice` with a per-language memo.
 *
 * The device's voice list does not change between replies, so scanning it for
 * the same tag on every turn was pure repeated work. Only positive matches are
 * cached: an unmatched tag is re-checked, because the platform may still be
 * loading the list.
 */
function resolveVoiceCached(
  voices: SpeechSynthesisVoice[],
  lang: string
): { voice: SpeechSynthesisVoice | null; matched: boolean } {
  const key = lang.toLowerCase();
  const hit = resolvedVoiceCache.get(key);

  if (hit !== undefined) {
    return hit;
  }

  const resolved = resolveVoice(voices, lang);

  if (voices.length > 0) {
    resolvedVoiceCache.set(key, resolved);
  }

  return resolved;
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

  // The notice is passive, so this may take its time: a warm cache answers
  // instantly, and a cold one waits the full window rather than reporting a
  // missing voice that is merely still loading.
  const voices = await waitForVoices(1000);
  return resolveVoiceCached(voices, lang).matched;
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

  const voices = await voicesForSpeech();
  const resolved = resolveVoiceCached(voices, lang);
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
