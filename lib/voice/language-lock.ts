import type { VoiceLanguageCode } from "@/lib/voice/types";
import type { EmotionHint } from "@/lib/brain/types";

/**
 * The Language Locker.
 *
 * LIVE BUG THIS FIXES: a Bangla utterance could come back as an unrelated
 * Latin-script language (Italian-like output is the classic symptom, because a
 * multilingual model maps Bengali phonetics onto the nearest language in its
 * own set) and Elara could then answer in that wrong language.
 *
 * The locker is deliberately deterministic — no model call, no scoring model,
 * no guessing:
 *
 *   - Bangla script (U+0980–U+09FF) is CERTAIN Bangla.
 *   - Romanised Bangla ("kemon acho", "ami bhalo") is certain enough.
 *   - Common English words are certain English.
 *   - ANYTHING ELSE IS `null` — "cannot tell" — and the previous lock is held.
 *
 * That last rule is the important one. A bare city name ("Dhaka") is one word
 * of Latin script; it is not evidence of any language, so it must never move
 * the lock. Guessing is exactly how a turn ends up answered in the wrong
 * language, so the locker only ever switches on positive evidence.
 */

/** Bangla Unicode block, covering script and Bangla digits/punctuation. */
const BANGLA_SCRIPT = /[\u0980-\u09FF]/;

/**
 * Romanised Bangla markers ("Banglish").
 *
 * Whole words only. Kept to high-frequency, low-ambiguity tokens so an English
 * sentence that happens to contain a similar-looking word is not captured.
 */
const BANGLISH_MARKERS =
  /\b(kemon|achen|acho|achis|bhalo|valo|bhala|ami|tumi|apni|tomar|amar|kotha|kothay|dhonnobad|onek|khub|ekhon|taka|bangla|bhai|bondhu|koro|korcho|korte|hobe|hoy|nai|nei|jani|bolo|bolen|suno|kemon\s+acho|kemon\s+achen|ki\s+koro|ki\s+korcho)\b/gi;

/**
 * How many DISTINCT Banglish markers a turn must carry before it counts.
 *
 * One romanised token is not evidence. "taka", "bhalo" and "bangla" all
 * appear inside ordinary English sentences, and switching the reply language on
 * one of them is exactly how a turn ends up answered in the wrong language.
 * Two still passes every real Banglish turn ("kemon acho", "ami bhalo achi").
 */
const BANGLISH_MARKER_THRESHOLD = 2;

/** Distinct lowercased Banglish markers present in the text. */
function banglishMarkerCount(text: string): number {
  const found = new Set<string>();
  // A fresh regex per call: the /g flag makes lastIndex stateful across calls.
  const pattern = new RegExp(BANGLISH_MARKERS.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    found.add(match[1].toLowerCase());
  }

  return found.size;
}

/**
 * High-frequency English words.
 *
 * ENGLISH ONLY KICKS IN ON REAL EVIDENCE — a function word or a very common
 * conversational word. A single proper noun or an isolated short token is not
 * enough, which keeps the lock stable across follow-up answers.
 */
const ENGLISH_MARKERS =
  /\b(the|and|you|your|yours|is|are|was|were|am|what|how|why|when|where|who|which|can|could|would|should|will|do|does|did|not|but|for|with|have|has|had|hello|hi|hey|thanks|thank|please|name|weather|forecast|temperature|tell|joke|good|bad|sad|happy|sorry|love|like|think|know|want|need|going|today|tomorrow|yesterday|because|about|just|really|again|something|anything)\b/i;

/** True when the text contains Bangla script characters. */
export function containsBanglaScript(text: string): boolean {
  return BANGLA_SCRIPT.test(text);
}

/** True when Latin-script text carries recognisably romanised Bangla. */
export function looksLikeBanglish(text: string): boolean {
  return (
    !containsBanglaScript(text) &&
    banglishMarkerCount(text) >= BANGLISH_MARKER_THRESHOLD
  );
}

/**
 * Whether this turn is evidence enough to move the whole SESSION into Bangla.
 *
 * This is a bigger decision than the reply lock: there is no real-time Bengali
 * model on the STT side at all, so Bangla audio can only be transcribed by the
 * browser's own recognizer - a completely different microphone pipeline. The
 * escalation is therefore deliberate and needs the same bar as the reply lock:
 * Bangla script, or two distinct Banglish markers. A lone romanised word, or a
 * place name like "Bangladesh", never escalates.
 */
export function shouldEscalateToBangla(text: string): boolean {
  return (
    containsBanglaScript(text) ||
    banglishMarkerCount(text) >= BANGLISH_MARKER_THRESHOLD
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Script evidence for the wider accepted language set.

   Only scripts that are UNAMBIGUOUS to one accepted language are listed.
   Latin-script languages (es fr de it pt da nl fi no sv tr vi ca) are
   deliberately ABSENT: their alphabets cannot be told apart by a cheap
   deterministic check, so `detectTurnLanguage` returns `null` for them and the
   full-turn lock HOLDS whatever the language picker chose — which is the
   correct, guess-free behaviour. Keyword-only language guessing is forbidden;
   these are script facts, not word lists.
   ────────────────────────────────────────────────────────────────────────── */

/** Kana (Hiragana + Katakana) — uniquely Japanese. */
const KANA_SCRIPT = /[\u3040-\u30FF]/;
/** Devanagari — uniquely Hindi among the accepted set (Bengali has its own). */
const DEVANAGARI_SCRIPT = /[\u0900-\u097F]/;
/** Hebrew block — uniquely Hebrew. */
const HEBREW_SCRIPT = /[\u0590-\u05FF]/;
/** Arabic blocks — Arabic among the accepted set (Hebrew has its own block). */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
/** CJK Unified Ideographs — Chinese when no kana is present. */
const HAN_SCRIPT = /[\u4E00-\u9FFF]/;

/* ──────────────────────────────────────────────────────────────────────────
   A1 — HARD ENGLISH LOCK.

   Detection is a heuristic, but a direct instruction is not: when the person
   says "stick to English", that is an explicit, unambiguous request and it
   outranks every marker in this file. It is matched defensively: a sentence
   naming ANOTHER language ("reply in Bangla, not English") must never be
   mistaken for an English-only command, and a bare "weather in English" with
   no command verb is not a command either.
   ────────────────────────────────────────────────────────────────────────── */

const ENGLISH_ONLY_COMMAND =
  /(?:\b(?:stick|stay|keep|switch|reply|respond|answer|speak|talk|say|tell|write|continue)\b[^.?!]{0,40}\benglish\b|\b(?:english\s+only|only\s+(?:in\s+)?english|just\s+english|in\s+english\s+only)\b)/i;

/** Any language other than English; its presence cancels an English-only match. */
const OTHER_LANGUAGE_NAME =
  /\b(?:bangla|bengali|hindi|urdu|arabic|spanish|french|german|italian|portuguese|japanese|chinese|korean|russian)\b/i;

/**
 * True when the person is EXPLICITLY asking Elara to stay in English.
 *
 * This is the A1 hard lock: the caller pins the session to `en` while this
 * holds, so a later romanised word can never drag the conversation back into
 * another language against the person's stated wish.
 */
export function wantsEnglishOnly(text: string): boolean {
  if (containsBanglaScript(text) || OTHER_LANGUAGE_NAME.test(text)) {
    return false;
  }

  return ENGLISH_ONLY_COMMAND.test(text);
}

/* ──────────────────────────────────────────────────────────────────────────
   U4 — EXPLICIT LANGUAGE REQUESTS.

   The lock is normally INFERRED (script evidence, Banglish markers) and HOLDS
   when there is nothing certain to go on — the guess-free rule that keeps a
   bare place name from moving the conversation. A direct instruction is not an
   inference: "reply in Spanish", "speak Hindi to me", "can we do this in
   French?" is the person TELLING us the language — which is exactly the
   evidence a Latin-script lock can never get from text alone, and the reason a
   supported lock could sit on English for ever.

   Read deterministically, like the A1 English lock, and generalised to every
   language the voice layer accepts.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Language names, in the two spellings people actually use: English and the
 * language's own. Latin-script names are matched whole-word so "Polish" in
 * "polish my shoes" never lands here.
 */
const LANGUAGE_NAME_PATTERNS: readonly (readonly [VoiceLanguageCode, RegExp])[] = [
  ["bn", /\b(?:bangla|bengali)\b|বাংলা/i],
  ["hi", /\b(?:hindi|hindustani|urdu)\b|हिन्दी|हिंदी/i],
  ["ar", /\b(?:arabic|arabiya)\b|العربية/i],
  ["he", /\b(?:hebrew|ivrit)\b|עברית/i],
  ["ja", /\b(?:japanese|nihongo)\b|日本語/i],
  ["zh", /\b(?:chinese|mandarin|cantonese|putonghua)\b|中文|汉语|漢語/i],
  ["es", /\b(?:spanish|espanol|español|castellano)\b/i],
  ["fr", /\b(?:french|francais|français)\b/i],
  ["de", /\b(?:german|deutsch)\b/i],
  ["it", /\b(?:italian|italiano)\b/i],
  ["pt", /\b(?:portuguese|portugues|português)\b/i],
  ["da", /\b(?:danish|dansk)\b/i],
  ["nl", /\b(?:dutch|nederlands)\b/i],
  ["fi", /\b(?:finnish|suomi)\b/i],
  ["no", /\b(?:norwegian|norsk|bokmal|bokmål)\b/i],
  ["sv", /\b(?:swedish|svenska)\b/i],
  ["tr", /\b(?:turkish|turkce|türkçe)\b/i],
  ["vi", /\b(?:vietnamese|tieng\s+viet|tiếng\s+việt)\b/i],
  ["ca", /\b(?:catalan|catalla|catallà|català)\b/i],
];

/**
 * What turns a language NAME into an INSTRUCTION.
 *
 * Needs a command or "in …" shape — a topic mention ("I love French films",
 * "my German is rusty") must never move the lock. "only" is included because
 * "Bangla only, please" is the plainest instruction there is.
 */
const LANGUAGE_INSTRUCTION =
  /\b(?:speak|talk|reply|respond|answer|write|say|tell\s+me|switch|stick|stay|keep|continue|use|only|just)\b|\bin\s+(?:your\s+)?(?:repl(?:y|ies)|responses?|answers?)\b|\b(?:in|to)\s+[a-zà-ÿ]+\s+(?:please|only)\b/i;

/**
 * The language the person EXPLICITLY asked Elara to use, or `null`.
 *
 * When one sentence names more than one language ("reply in Spanish, not
 * French"), the LAST name wins: that is the correction, and it is the language
 * they want. English is deliberately absent from the table — it has its own
 * hardened matcher above (`wantsEnglishOnly`), which also handles the "not
 * English" negation.
 */
export function explicitLanguageRequest(
  text: string,
): VoiceLanguageCode | null {
  if (!LANGUAGE_INSTRUCTION.test(text)) {
    return null;
  }

  let requested: VoiceLanguageCode | null = null;
  let lastIndex = -1;

  for (const [code, pattern] of LANGUAGE_NAME_PATTERNS) {
    const match = pattern.exec(text);

    if (match !== null && match.index > lastIndex) {
      lastIndex = match.index;
      requested = code;
    }
  }

  return requested;
}

/**
 * The language certain SCRIPT evidence identifies this turn as, or `null`.
 *
 * Kept separate from `detectTurnLanguage` because callers sometimes need to know
 * whether the evidence was a script (a fact about the text) or a marker
 * heuristic (a hint): script evidence is strong enough to break an explicit pin,
 * a heuristic never is.
 *
 * Order matters where blocks neighbour: kana before Han, because Japanese mixes
 * kanji with kana while Chinese uses Han alone.
 */
export function scriptEvidenceLanguage(
  text: string,
): VoiceLanguageCode | null {
  if (containsBanglaScript(text)) {
    return "bn";
  }

  if (KANA_SCRIPT.test(text)) {
    return "ja";
  }

  if (DEVANAGARI_SCRIPT.test(text)) {
    return "hi";
  }

  if (HEBREW_SCRIPT.test(text)) {
    return "he";
  }

  if (ARABIC_SCRIPT.test(text)) {
    return "ar";
  }

  if (HAN_SCRIPT.test(text)) {
    return "zh";
  }

  return null;
}

/**
 * The language this single utterance is CERTAIN to be, or `null` for
 * "cannot tell". `null` is not a failure — it is the locker refusing to guess.
 *
 * Order matters: Bangla and Japanese have priority over the broader blocks
 * they neighbour (Bengali vs Devanagari are disjoint, but Han must lose to
 * kana because Japanese mixes both while Chinese uses Han alone).
 */
export function detectTurnLanguage(text: string): VoiceLanguageCode | null {
  // A direct instruction from the person outranks any detection heuristic.
  if (wantsEnglishOnly(text)) {
    return "en";
  }

  if (containsBanglaScript(text)) {
    return "bn";
  }

  if (shouldEscalateToBangla(text)) {
    return "bn";
  }

  /*
   * U4: an explicit request ("reply in Spanish", "speak Hindi to me") is
   * EVIDENCE, not a guess, so it moves the lock even for a language whose script
   * cannot be told apart from English — the one route by which a supported lock
   * could otherwise sit on English for ever.
   */
  const requested = explicitLanguageRequest(text);

  if (requested !== null) {
    return requested;
  }

  // Kana before Han: Japanese uses kanji + kana together; Chinese uses Han alone.
  const scripted = scriptEvidenceLanguage(text);

  if (scripted !== null) {
    return scripted;
  }

  if (ENGLISH_MARKERS.test(text)) {
    return "en";
  }

  // Latin-script languages and anything outside the accepted set: cannot tell.
  return null;
}

/**
 * Full-turn lock resolution.
 *
 * A certain detection moves the lock; an uncertain one HOLDS the previous lock,
 * so a follow-up answer ("Dhaka" after "which city?") stays in the language the
 * conversation is already using instead of resetting to a default.
 */
export function resolveLockedLanguage(
  previous: VoiceLanguageCode,
  detected: VoiceLanguageCode | null,
): VoiceLanguageCode {
  return detected ?? previous;
}

/**
 * Whether a transcript is too thin to act on.
 *
 * A single stray character is almost always a mis-trigger of the recogniser
 * (breath, a chair creak, background speech). The caller asks the person to
 * repeat instead of sending noise to the brain — the "clarify rather than
 * guess" rule.
 */
/**
 * Function words that cannot be a whole turn on their own.
 *
 * LIVE SYMPTOM THIS CLOSES: cutting the microphone in the middle of a sentence
 * — or starting to speak while Elara's reply is still playing, where the first
 * words of the utterance are dropped along with the playback — leaves the
 * recogniser holding a tail fragment. It was then finalized as a turn of its
 * own ("will.", "me?") and answered as if it were a real message.
 *
 * A stranded function word is not a message, so the caller asks the person to
 * repeat instead. Deliberately NARROW: one token, closed-class only, and every
 * content word plus the real one-word replies ("yes", "no", "thanks", "stop",
 * "why?", "what?") stay perfectly usable.
 */
const ORPHAN_FRAGMENT_WORDS: ReadonlySet<string> = new Set([
  // Articles, conjunctions, prepositions.
  "a", "an", "the", "and", "or", "but", "so", "because", "if", "than", "as",
  "of", "to", "in", "on", "at", "for", "with", "from", "by", "into", "over",
  "under", "about", "that", "which", "while", "though", "then",
  // Auxiliaries and the verb "be".
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "do", "does", "did", "have", "has", "had", "am", "is", "are", "was", "were",
  "be", "been", "being",
  // Pronouns and determiners that cannot carry a turn alone.
  "i", "me", "you", "he", "she", "it", "we", "us", "they", "them", "him",
  "her", "my", "your", "our", "their", "his", "its", "this", "these", "those",
]);

/** Punctuation-free, lowercased tokens of a transcript (any script). */
function tokenizeTranscript(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** True when the entire transcript is one stranded function word. */
function isOrphanFragment(text: string): boolean {
  const tokens = tokenizeTranscript(text);
  return tokens.length === 1 && ORPHAN_FRAGMENT_WORDS.has(tokens[0]);
}

/**
 * Is this transcript too thin to act on?
 *
 * Two shapes, both ending in the same in-language clarify line rather than a
 * model call: a stray character left by a breath or a chair creak (the rule
 * described above), and a single stranded function word — a tail fragment from
 * an utterance cut off mid-sentence.
 */
export function isLowConfidenceTranscript(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 2) {
    return true;
  }

  // No letters or digits at all — punctuation or stray marks only.
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  // A single stranded word — a tail fragment, not a message.
  return isOrphanFragment(trimmed);
}

/* ──────────────────────────────────────────────────────────────────────────
   EMOTION HINT — Voice Brain → Main Brain.

   Deterministic, model-free, and deliberately conservative: only strong,
   unambiguous signals produce a hint; everything else is `null` (no line is
   added to the prompt). The hint never GATES content — it only adds one tone
   line so the reply matches the moment. Bangla signals included so the demo
   language gets the same colouring.
   ────────────────────────────────────────────────────────────────────────── */

const EMOTION_SIGNALS: readonly (readonly [EmotionHint, RegExp])[] = [
  [
    "low",
    /\b(?:sad|lonely|alone|down|depressed|crying|upset|heartbroken|miserable|exhausted|tired of)\b|দুঃখ|একা|খারাপ লাগ|কষ্ট/i,
  ],
  [
    "worried",
    /\b(?:worried|anxious|nervous|stressed|scared|afraid|panic(?:king)?)\b|উদ্বিগ্ন|চিন্তিত|ভীতু/i,
  ],
  [
    "playful",
    /\b(?:lol|haha|hehe|joke|funny|playful|tease|prank|goof(?:y|ing))\b|মজা|হাহা|খেলা/i,
  ],
  [
    "bright",
    /\b(?:happy|great|awesome|amazing|excited|fantastic|thrilled|lovely|good news)\b|খুশি|আনন্দ|দারুণ|উৎসাহিত/i,
  ],
];

/**
 * The emotion this utterance is STRONGLY suggesting, or `null` for the common
 * case of no clear signal. First match wins, ordered most-heavy to
 * most-light, so "sad but trying to joke" still reads as low.
 */
export function detectEmotionHint(text: string): EmotionHint | null {
  for (const [hint, pattern] of EMOTION_SIGNALS) {
    if (pattern.test(text)) {
      return hint;
    }
  }

  return null;
}

/**
 * Resolves a spoken reply's language against the full-turn lock.
 * locked language is caught at the boundary even if the main model drifts.
 *
 *   - Script-locked languages (bn hi ar he ja zh) require their own script.
 *     Japanese additionally rejects Han-only text (that would be Chinese);
 *     Chinese rejects kana-bearing text (that would be Japanese).
 *   - Latin-script locks (en es fr de …) cannot be told apart BY script, but a
 *     reply written in Devanagari, Arabic, kana or Han characters is CERTAINLY
 *     not English — that is the "random Bangla/Hindi mid English conversation"
 *     bug, and every such script is rejected outright. Two Latin-script
 *     languages still cannot be told apart here: deeper verification is the
 *     language directive's job, because a classifier on this path would add
 *     latency the voice loop does not have.
 */
/**
 * Scripts that can NEVER appear in a reply locked to a Latin-script language:
 * Bengali + Devanagari, Arabic, Hebrew, Greek, kana/Han, Thai and Hangul.
 *
 * This is the deterministic half of "no random Bangla/Hindi mid English
 * conversation": one Devanagari or Bengali word inside an otherwise English
 * reply is a wrong-language reply, and it is caught without a classifier.
 */
const NON_LATIN_SCRIPT =
  /[\u0900-\u09FF\u0600-\u06FF\u0590-\u05FF\u0370-\u03FF\u3040-\u30FF\u3400-\u9FFF\u0E00-\u0E7F\uAC00-\uD7AF]/;

export function replyLanguageMatches(
  reply: string,
  locked: VoiceLanguageCode,
): boolean {
  switch (locked) {
    case "bn":
      return containsBanglaScript(reply);
    case "hi":
      return DEVANAGARI_SCRIPT.test(reply);
    case "ar":
      return ARABIC_SCRIPT.test(reply);
    case "he":
      return HEBREW_SCRIPT.test(reply);
    case "ja":
      return KANA_SCRIPT.test(reply);
    case "zh":
      return HAN_SCRIPT.test(reply) && !KANA_SCRIPT.test(reply);
    default:
      // en + every Latin-script language: ANY other script fails the match.
      return !NON_LATIN_SCRIPT.test(reply);
  }
}
