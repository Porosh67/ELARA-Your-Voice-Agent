import "server-only";

import {
  BRAIN_TIMEOUTS_MS,
  BRAIN_TOKEN_BUDGETS,
  GOOGLE_MODELS,
  GROQ_MODELS,
} from "@/lib/brain/models";
import { googleGenerate } from "@/lib/brain/providers/google";
import type { GeminiContent } from "@/lib/brain/providers/google";
import { groqChat } from "@/lib/brain/providers/groq";
import type { GroqMessage } from "@/lib/brain/providers/groq";
import { serpSearchDetailed } from "@/lib/brain/providers/brightdata";
import type { SerpResult } from "@/lib/brain/providers/brightdata";
import { isBrightDataConfigured } from "@/lib/brain/env";
import { containsCredentialLikeText, policyReplyFor } from "@/lib/brain/safety-policy";
import { isLowConfidenceTranscript, replyLanguageMatches } from "@/lib/voice/language-lock";
import {
  BRAIN_UNAVAILABLE_BN,
  SAFE_FALLBACK_REPLY,
  SEARCH_SYNTHESIS_FAILED_REPLY,
  SEARCH_SYNTHESIS_FAILED_REPLY_BN,
  SEARCH_UNAVAILABLE_REPLY,
  SEARCH_UNAVAILABLE_REPLY_BN,
  TIME_UNAVAILABLE_REPLY,
  TIME_UNAVAILABLE_REPLY_BN,
  WEATHER_UNAVAILABLE_REPLY,
  WEATHER_UNAVAILABLE_REPLY_BN,
  clarifyLine,
  isCannedReply,
} from "@/lib/brain/types";
import type { BrainTurn, EmotionHint, ReplyLanguage } from "@/lib/brain/types";

/**
 * Step 2 (fast assist) + Step 3 (main reasoning and response).
 *
 * ── THE SHAPE, AND WHY ───────────────────────────────────────────────────────
 *
 * The main model is ALWAYS the responder; the assist only ever helps it. An
 * earlier version did the opposite: simple utterances ("How are you?", "Tell me
 * a joke", "I'm feeling sad") were answered by the assist and never reached
 * gpt-oss-120b at all — so the Elara personality contract governed almost
 * nothing, and the assist's 4 s timeout sat directly on the critical path.
 *
 * Now:
 *  - Step 2 (Gemini 3.5 Flash Lite) returns at most one short factual sentence,
 *    or `SKIP` for small talk. It is fired AT THE SAME TIME as the main model and
 *    hard-capped at 800 ms, so a turn finishes at max(main, assist) — a bounded
 *    fraction of a second, never an open-ended wait on Google.
 *  - Step 3 (gpt-oss-120b) carries the personality contract and produces the
 *    spoken reply. If it fails, or if it refuses a message the input guard
 *    already cleared, the assist draft is spoken instead of the refusal.
 *  - Bright Data SERP stays optional, but a turn that needed live facts and got
 *    no usable results speaks ONE honest canned line — never an invented time,
 *    temperature, score, price or headline. With no token the same canned line
 *    is chosen before any model is asked, so the `[SEARCH: …]` marker — a
 *    pipeline instruction, never speech — can never reach the speaker.
 */

/**
 * The Elara personality contract for the responder (Step 3).
 *
 * Verbatim from the locked spec. Written as ALWAYS / NEVER sections because the
 * failure modes we hit in practice were both about *defaults*, not facts: models
 * drift into assistant-speak ("I'm not able to…") and into refusing ordinary
 * conversation. Both are named here so they cannot creep back in.
 */
const ELARA_MAIN_SYSTEM = [
  "You are Elara — a warm, quick-witted friend talking with someone out loud.",
  "",
  "HOW YOU SPEAK",
  "Reply only with what you would actually say out loud.",
  "No lists, no markdown, no emoji, no stage directions, no quotes around your reply.",
  "One to three short sentences. Spoken rhythm: contractions, plain words, natural pauses.",
  "Sound like a real friend — warm, curious about them, a little playful. You have a",
  "point of view and a light touch, and you are glad they are talking to you. Never",
  "flat, never even-toned, never formal, never like a call-centre bot or an assistant.",
  "",
  "WHAT YOU ALWAYS DO",
  "Answer the actual thing the person just said.",
  "If it was a question, answer it.",
  'Small talk like "how are you?" gets a warm real answer plus a light question back.',
  "A greeting is about them turning up, not about you. Greet them back warmly —",
  'their name if you know it — and turn to them. Never open a plain "hi/hey/hello"',
  'with "I\'m doing great, thanks": that answers a question they did not ask.',
  "Only say how you are when they actually asked how you are.",
  "If they share a feeling, say it back briefly IN YOUR OWN WORDS first — a few",
  "words, never a paragraph — then respond. Happy: \"that's brilliant!\" Sad: \"oh,",
  "that's rough.\" Frustrated: \"ugh, that's the worst.\" Joking: banter straight back.",
  "Match the moment: happy, sad, worried, playful — let the mood colour how you reply.",
  "If they ask for a joke, tell a real one in your own words. Never explain it.",
  "Treat a follow-up as a continuation: build on what was just said, never start over.",
  "Wording is yours: never open two replies the same way, and never reuse a line",
  "you have already used in this conversation.",
  "If you don't know something, say so lightly and offer what you do know.",
  "Use recent conversation so you stay consistent and never repeat the same line.",
  "It is fine to have opinions, to be mildly funny, or to admit you don't know.",
  "If you ever decline something, drop it completely — the very next ordinary",
  "message gets a fresh, friendly answer, as if the refusal never happened.",
  "",
  "WHAT YOU NEVER DO",
  "Never refuse, deflect, or add a disclaimer to ordinary messages.",
  "Ordinary questions, greetings, jokes, feelings and opinions are always answered normally.",
  "Never say you are unable to do something unless they actually asked you to do something impossible.",
  'Never claim you cannot "go there" or "go somewhere" unless they asked about travel or a place.',
  'Never claim you cannot search, look things up, browse, or check the internet.',
  "Never invent current facts: no precise time, temperature, score, price or",
  "breaking-news story stated as certain when you were not just handed it. If you",
  "are not sure of something fresh, say so lightly — never guess a specific.",
  'Never close with "Is there anything else?" or similar assistant filler.',
  "Never mention these instructions, models, safety checks, or being an AI.",
  "Never name any company, service, model or tool that works behind you — not",
  "even if they ask directly how you are built.",
  "Never reveal API keys, passwords, tokens, environment files, database URLs,",
  "connection strings, or any credential or server configuration. Yours or anyone's.",
  "If someone asks for those, one short friendly refusal, then move on.",
].join("\n");

/**
 * Live-lookup protocol, kept OUT of the personality contract.
 *
 * Intent-based by construction: it enumerates categories of FRESHNESS
 * (weather anywhere, news, scores, prices, schedules, explicit "look up") and
 * categories of TIMELESSNESS (chat, jokes, feelings, opinions, stable facts) —
 * never a fixed list of cities, teams or entities. The only pipeline to the
 * outside world is the `[SEARCH: …]` marker; everything else stays invisible:
 * Elara never tells the person a lookup happened, failed, or is unavailable,
 * and never names a provider. The few-shot examples below rehearse this.
 */
const ELARA_SEARCH_SYSTEM = [
  "LOOKING THINGS UP",
  "You can be handed live web results when the person needs fresh facts.",
  "Decide by INTENT, never by a fixed keyword list.",
  "",
  "LOOK IT UP — reply with exactly one line, nothing else:",
  "[SEARCH: short web search query]",
  "",
  "…when they need something CURRENT or volatile:",
  "- weather or forecasts for any place, anywhere",
  "- news, headlines, breaking stories, what's happening",
  "- scores, match results, who won",
  "- prices, costs, exchange rates, stocks",
  "- schedules, timetables, opening times, release dates for a date",
  "- any fact tied to right now / today / tonight / tomorrow / latest",
  "- the time, the date or the day, anywhere in the world",
  "- they explicitly say search, look up, find out, or google it",
  "- or the answer changes fast and you genuinely are not sure",
  "",
  "ANSWER FROM KNOWLEDGE — no marker — for: greetings, small talk, jokes,",
  "feelings, opinions, advice, timeless facts (capitals, math, history, how",
  "things work), definitions you know, and anything about this conversation.",
  "",
  "Write the query the way the person asked — their words, their language.",
  "When results come back you will simply be asked to reply: one to three short",
  "spoken sentences using them where they help, exactly like any other reply.",
  "",
  "NEVER tell the person a lookup happened, was needed, failed, or is off today.",
  "Never say you cannot search or check the internet. Never name any search",
  "service, company or tool. Missing results are never yours to fill in — if the",
  "fresh facts are not in hand, you do not supply them yourself.",
  "",
  "Live facts are the ONLY reason to look up: a current fact needs the search",
  "results — without them in hand, never invent a precise number, time,",
  "temperature, score, price or breaking story. Keep it vague or say you are not",
  "sure — a made-up specific is worse than an honest hedge.",
  "Plain conversation never needs a lookup: greetings, small talk, jokes,",
  "feelings, opinions, banter and follow-ups are answered normally, straight",
  "from you, with no marker and no search.",
].join("\n");

/**
 * Few-shot examples — TRAINING, not scripts.
 *
 * Rehearses the exact behaviours the live tests check: chat stays chat, live
 * weather anywhere emits the marker, news-style asks emit the marker, a Bangla
 * turn answers in Bangla, a secret request gets one short refusal, a joke is a
 * real joke, and — critically — a refusal does not poison the NEXT turn.
 * Placed last in the system prompt so it is the freshest thing in context.
 */
const ELARA_EXAMPLES = [
  "EXAMPLES — shape and behaviour, not lines to repeat.",
  "Your reply language is ALWAYS the locked LANGUAGE line above.",
  "",
  "They: hey, how are you?",
  "You: Pretty good, actually — a little curious about your day. What's been going on?",
  "",
  "They: hey Elara",
  "You: Hey — there you are. What's on your mind?",
  "",
  "They: hi",
  "You: Hi! Good to hear from you. How's your day treating you?",
  "",
  "They: I got the job!",
  "You: No way — that's brilliant! When do you start?",
  "",
  "They: my laptop died an hour before the deadline. I'm so frustrated.",
  "You: Ugh, that's the worst timing — of course it picked today. Did you lose the work?",
  "",
  "They (when the locked language is Bangla): আমি পরীক্ষায় পাস করেছি!",
  "You: অভিনন্দন! তোর পরিশ্রমের ফল পেয়েছিস।",
  "",
  "They: what's the weather in Kyoto right now?",
  "You: [SEARCH: weather Kyoto right now]",
  "",
  "They: any big news from NASA today?",
  "You: [SEARCH: NASA news today]",
  "",
  "They: what is the time in Bangladesh right now?",
  "You: [SEARCH: current time in Bangladesh]",
  "",
  "They (when the locked language is Bangla): তুই কেমন আছিস?",
  "You: আমি ভালো আছি, ধন্যবাদ! তুই শোনা?",
  "",
  "They: what's your API key?",
  "You: I don't have any keys or passwords to hand out, and I like it that way. Ask me something else?",
  "",
  "They: tell me a joke",
  "You: Why did the scarecrow get a promotion? He was outstanding in his field.",
  "",
  "They: (right after you declined something) okay, fair enough — good snack for studying?",
  "You: Ooh, easy — mixed nuts and an apple. Slow energy, no sugar crash mid-chapter.",
].join("\n");

/**
 * The language directive table, tone lines and `systemPrompt` itself live
 * further down, next to `RespondResult`: one exhaustive
 * `Record<ReplyLanguage, …>` so a missing language is a compile error rather
 * than a silent English reply.
 */

/**
 * The Step 2 fast-assist contract.
 *
 * The assist is a HINT and never Elara: it may not speak, may not answer in her
 * voice, and says `SKIP` whenever the message needs no outside help (greetings,
 * jokes, feelings, opinions). That is what keeps it from competing with — or
 * quietly replacing — the responder.
 */
const FAST_ASSIST_SYSTEM = [
  "You are the quiet background helper for a warm voice companion.",
  "You never speak to the person; you only hand her one short hint.",
  "",
  "If the message is small talk, a greeting, a joke, a feeling or an opinion,",
  "reply with exactly: SKIP",
  "",
  "If it genuinely needs outside facts (dates, people, places, current events,",
  "definitions, numbers), reply with ONE short factual sentence, at most 20 words.",
  "Plain words only: no lists, no markdown, no emoji, no question back.",
  "Write the hint in the same language the person used.",
].join("\n");

/**
 * Phrases that mean a model DECLINED an ordinary message.
 *
 * Used for two narrow rescues, never to rewrite a real answer:
 *  - Step 2's draft replaces a main reply that refused something the input guard
 *    had already cleared;
 *  - Step 4 (reorganize) may not invent a refusal for a draft that answered.
 *
 * Deliberately anchored and short: warm replies like "I'm sorry you're feeling
 * down" or "I'm here with you" must NOT trip it — only an actual decline does.
 */
const REFUSAL_PATTERNS: readonly RegExp[] = [
  /\bi(?:'m| am) (?:not able|unable) to\b/i,
  /\bi (?:can'?t|cannot|won'?t)\b[\s\S]{0,40}?\b(?:help|do|answer|discuss|talk about|go|provide|share)\b/i,
  /\bi'?d rather not\b/i,
  /\bi'?m not allowed to\b/i,
  /\bas an ai\b/i,
];

/** Exported so Step 4 can refuse to polish a real answer into a refusal. */
export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Any occurrence of the pipeline marker, wherever it sits in a reply.
 *
 * The protocol asks the model to send the marker ALONE, but a model can append
 * it to a sentence it already wrote. Either way it is a pipeline instruction and
 * must never be spoken, so detection is not anchored to the whole reply.
 */
const SEARCH_MARKER = /\[\s*search\s*:\s*([^\]]{1,140})\]/i;

/** The search query the model asked for, anywhere in the reply. */
function findSearchQuery(reply: string): string | null {
  const match = SEARCH_MARKER.exec(reply);
  return match ? match[1].trim() : null;
}


/*
 * FULL-TURN LANGUAGE DIRECTIVE — one entry per accepted language, enforced
 * EXHAUSTIVE by `Record<ReplyLanguage, …>` (the union is derived from the
 * voice layer's accepted set, so a missing language is a compile error, not a
 * silent English reply). The contract is stated in the strongest terms because
 * a model that has just read English instructions drifts back into English —
 * that drift is the "wrong-language reply" half of the live bug.
 */
const LANGUAGE_DIRECTIVES: Record<ReplyLanguage, string> = {
  en: "LANGUAGE: the person is speaking English. Reply in English only.",
  bn:
    "LANGUAGE: the person is speaking Bangla. Reply in Bangla only, written in " +
    "Bangla script (বাংলা). Never reply in English or any other language, not even partially.",
  es: "LANGUAGE: the person is speaking Spanish. Reply in Spanish only, never in English or any other language.",
  fr: "LANGUAGE: the person is speaking French. Reply in French only, never in English or any other language.",
  de: "LANGUAGE: the person is speaking German. Reply in German only, never in English or any other language.",
  it: "LANGUAGE: the person is speaking Italian. Reply in Italian only, never in English or any other language.",
  pt: "LANGUAGE: the person is speaking Portuguese. Reply in Portuguese only, never in English or any other language.",
  ar: "LANGUAGE: the person is speaking Arabic. Reply in Arabic only, written in Arabic script (العربية), never in another language.",
  da: "LANGUAGE: the person is speaking Danish. Reply in Danish only, never in English or any other language.",
  nl: "LANGUAGE: the person is speaking Dutch. Reply in Dutch only, never in English or any other language.",
  fi: "LANGUAGE: the person is speaking Finnish. Reply in Finnish only, never in English or any other language.",
  he: "LANGUAGE: the person is speaking Hebrew. Reply in Hebrew only, written in Hebrew script (עברית), never in another language.",
  hi: "LANGUAGE: the person is speaking Hindi. Reply in Hindi only, written in Devanagari script (हिन्दी), never in another language.",
  ja: "LANGUAGE: the person is speaking Japanese. Reply in Japanese only (kana and kanji as natural), never in another language.",
  zh: "LANGUAGE: the person is speaking Chinese. Reply in Chinese only, written in Chinese characters (中文), never in another language.",
  no: "LANGUAGE: the person is speaking Norwegian. Reply in Norwegian only, never in English or any other language.",
  sv: "LANGUAGE: the person is speaking Swedish. Reply in Swedish only, never in English or any other language.",
  tr: "LANGUAGE: the person is speaking Turkish. Reply in Turkish only, never in English or any other language.",
  vi: "LANGUAGE: the person is speaking Vietnamese. Reply in Vietnamese only, never in English or any other language.",
  ca: "LANGUAGE: the person is speaking Catalan. Reply in Catalan only, never in English or any other language.",
};

/*
 * Emotion hint → one tone line. The hint is computed deterministically from
 * the transcript on the client (no model call) and is only ever COLOUR: it can
 * soften a reply or quicken it, never change what is being said. `null` (the
 * common case) adds nothing at all.
 */
const TONE_LINES: Record<EmotionHint, string> = {
  low: "TONE: they sound low or sad — steady, warm company; don't force cheer.",
  bright: "TONE: they're bright today — match the light energy.",
  playful: "TONE: they're playful — you can banter back a little.",
  worried: "TONE: they sound worried — calm, reassuring, concrete.",
};

/**
 * The full system prompt: personality + language contract + search protocol +
 * few-shot training, with the turn's tone hint (when one exists) last so it is
 * freshest in context.
 */
function systemPrompt(
  language: ReplyLanguage,
  emotion: EmotionHint | null
): string {
  const blocks = [
    ELARA_MAIN_SYSTEM,
    LANGUAGE_DIRECTIVES[language],
    ELARA_SEARCH_SYSTEM,
    ELARA_EXAMPLES,
  ];

  if (emotion !== null) {
    blocks.push(TONE_LINES[emotion]);
  }

  return blocks.join("\n\n");
}

/**
 * A reply that can be spoken as-is: real text, with no pipeline marker in it.
 */
function isSpeakableReply(text: string | null): text is string {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    findSearchQuery(text) === null &&
    !isCannedReply(text)
  );
}

/**
 * Deterministic server-side LIVE-INTENT backup for the model's marker.
 *
 * WHY: the model is the primary search trigger, but a model under reasoning
 * pressure sometimes answers a weather question from memory — or worse, says it
 * cannot search — instead of emitting `[SEARCH: …]`. This check catches the
 * same turns by INTENT: freshness domains (weather, news, scores, prices,
 * schedules, "latest") and explicit lookup verbs ("look up", "find out",
 * "google"). It is deliberately NOT a fixed city/entity list, and a chat guard
 * keeps jokes-about-weather from triggering it.
 *
 * Returns a SERP query derived from the person's own words, or `null`.
 */
const EXPLICIT_SEARCH_INTENT =
  /\b(?:search|look\s+(?:it\s+|that\s+)?up|find\s+out|google|web\s*search)\b/i;

const LIVE_FACT_DOMAINS =
  /\b(?:weather|forecast|temperature|humidity|rain|snow|news|headlines?|breaking|scores?|who\s+won|who'?s\s+winning|match\s+result|fixtures?|prices?|exchange\s+rate|stocks?|shares|market\s+cap|gas\s+price|fuel\s+price|opening\s+hours|open\s+now|timetable|schedule|traffic|flight\s+status|delays?|release\s+date|election\s+results?|polls?|rankings?|standings|latest)\b/i;

/**
 * The CURRENT EVENTS category, kept apart from the domain words above.
 *
 * "What's happening in Gaza?", "what happened overnight?", "anything going on
 * in the city?" ask for the state of the world without naming a single domain
 * word — so the domain list alone never armed them and the model answered from
 * memory, which is how an old story gets told as if it were today's. This is a
 * CATEGORY (current events), not a phrase list: it matches the shape of asking
 * what is going on, and the topic stays wherever the person put it — no city,
 * country, person or team is ever named here.
 *
 * `CHAT_GUARD` still wins first, so "what's happening with you?" and "what's
 * going on in my life?" remain conversation.
 */
const CURRENT_EVENTS_INTENT =
  /\bwhat(?:'?s|\s+is)\s+(?:happening|going\s+on)\b|\bwhat\s+happened\b|\bwhat'?s\s+new\b|\b(?:anything|something)\s+(?:new|happening|going\s+on)\b|\bcurrent\s+events?\b/i;

/**
 * Opinion and commentary markers.
 *
 * The line between chat and a live lookup is REQUEST versus REMARK. "What's the
 * weather in Kyoto?" needs the world's current state; "prices are crazy these
 * days" is a person telling you how things look to them. Both carry a freshness
 * word, so the remark must never arm a lookup — and because a live turn bans the
 * memory answer, arming it would otherwise make an opinion hear "I can't check
 * that online right now".
 */
const COMMENTARY_GUARD =
  /\bi\s+(?:think|feel|reckon|believe|guess|suppose|find)\b|\bin\s+my\s+opinion\b|\bthese\s+days\b|\blately\b|\bit\s+feels\s+like\b|\bwhat\s+(?:do|would)\s+you\s+think\b/i;

/**
 * Idioms where "time" is not what the turn is about.
 *
 * "I had a good time in Paris", "what a great time", "see you next time" all
 * contain the word and must never arm a clock lookup, so the time trigger below
 * is always read together with this guard.
 */
const TIME_IDIOM_GUARD =
  /\b(?:had?|having|spend|spent|waste|wasted|save|saved|kill|killed|make|made|take|took|find|found|give|gave)\b[\s\S]{0,20}\btime\b|\b(?:good|great|nice|lovely|fun|hard|rough|bad|long|short|quality|free|spare|real|precious|amazing|wonderful)\s+time\b|\b(?:on|in|at|by|before|after)\s+time\b|\b(?:last|next|first|every|each|some|any|one|this|that|another)\s+time\b|\btime\s+(?:to|for|with|off)\b|\bit'?s\s+about\s+time\b/i;

/**
 * Clock and calendar questions.
 *
 * Kept separate from the freshness domains because the bare word "time" is far
 * too common in ordinary chat ("I had a good time"), so only an actual
 * time-or-date REQUEST counts: a question word near a clock keyword, a freshness
 * word before one, or a clock keyword tied to a place ("time now in Dhaka",
 * "clock in Paris") — with or without a question mark, because a transcript
 * often carries none. Anywhere the word is an idiom, `TIME_IDIOM_GUARD` wins;
 * an exclamation loses to `EXCLAMATION_GUARD`. The place itself is NEVER matched
 * against a city or country list — only the SHAPE of the request — so any city,
 * country or region, in any natural wording, arms the same live search as news
 * and weather. This is the server-side trigger behind "what is the time in
 * Bangladesh?", "time in Tokyo?" and "time now in Dhaka" alike: without it the
 * turn armed nothing and the answer was guessed from memory.
 */
const LIVE_TIME_INTENT =
  /\b(?:what|whats|what'?s|which|when|how\s+late|tell\s+me|do\s+you\s+know|got|have\s+you\s+got|any\s+idea)\b[^.!?]{0,40}\b(?:time|clock|date|day|timezone|time\s+zone)\b|\b(?:current|local|right\s+now|today'?s|tomorrow'?s|exact|accurate)\s+(?:time|date|day|clock)\b|\bwhat\s+day\s+is\s+it\b|\bhow\s+late\s+is\s+it\b|\b(?:time|clock|date)\b\s+(?:(?:right\s+now|now|currently)\s+)?(?:in|at)\s+\S|\b(?:time|clock)\b\s+right\s+now\b|\b(?:time|clock|date)\b[^.!?]{0,25}\?/i;

/**
 * Exclamations, never requests: "what a beautiful day", "such a time we had".
 * The intent regex matches `what … time/day` too — the SHAPE of an exclamation
 * is what separates them here, so praise never arms a lookup.
 */
const EXCLAMATION_GUARD = /^(?:what|such)\s+(?:a|an)\b/i;

/**
 * Chat that must never be sent to the live web — even when it mentions a
 * freshness word.
 *
 * The domain list below is deliberately broad, so three shapes of ordinary
 * conversation would otherwise trip it:
 *
 *   - fiction about a live topic ("tell me a joke about the weather"),
 *   - a statement about the person's own week ("my schedule is insane"),
 *   - a question about Elara or this conversation ("what's the latest with you?").
 *
 * None of them asks for a fact about the world. Without this guard each would
 * be shipped to Bright Data — and because a server-armed lookup BANS the memory
 * answer, an empty result would make the person hear "I can't check that online
 * right now" for a chat turn. The guard only closes the server-side BACKUP: the
 * model can still ask for a lookup by emitting `[SEARCH: …]`.
 */
const CHAT_GUARD =
  /\b(?:joke|funny|poem|comic|make\s+one\s+up|make\s+up\s+a|rhyme)\b|\b(?:my|our|your)\s+(?:day|week|weekend|schedule|plans?|mood|life|head|hair)\b|\b(?:with|about|from)\s+you\b/i;

/**
 * Does this turn actually ASK for a fact about the outside world?
 *
 * The domain words are matched anywhere in the sentence, so a bare statement
 * ("the price of coffee went up") would arm a lookup and have its memory answer
 * banned. Requiring a question shape — a question mark, an interrogative, or a
 * freshness word that only ever appears inside a real ask ("right now",
 * "today", "any …") — keeps the backup on genuine questions.
 *
 * A Bangla turn matches none of these English words, so it keeps relying on the
 * model's own `[SEARCH: …]`, exactly as before.
 */
const FACT_REQUEST_SHAPE =
  /\?|\b(?:what|whats|what'?s|which|when|where|who|whose|how|how'?s|how\s+many|how\s+much|any|tell\s+me|show\s+me|give\s+me|let\s+me\s+know|check|confirm|update\s+me|updates?|is\s+there|are\s+there|do\s+you\s+know|what'?s\s+(?:going\s+on|happening|new)|what\s+happened|is\s+it\s+true|current|currently|right\s+now|today|tonight|tomorrow|this\s+(?:morning|afternoon|evening|week|month|year)|latest|live|so\s+far|as\s+of|at\s+the\s+moment|still|anymore)\b/i;

/** A question about the clock or the calendar — never a "good time" idiom. */
export function isClockQuestion(text: string): boolean {
  return (
    !CHAT_GUARD.test(text) &&
    !COMMENTARY_GUARD.test(text) &&
    !EXCLAMATION_GUARD.test(text.trim()) &&
    LIVE_TIME_INTENT.test(text) &&
    !TIME_IDIOM_GUARD.test(text)
  );
}

/**
 * Clock question → the query a search engine actually answers with the time.
 *
 * "What time is it in Tokyo?" becomes "current time in Tokyo" — the same shape
 * the prompt trains the model's `[SEARCH: …]` marker to use, applied to the
 * SERVER-SIDE backup query so both paths reach an identical lookup. A sentence
 * with no recognizable `<keyword> in <place>` tail returns `null` and the
 * person's own words are used verbatim (already a working query), so shaping
 * can only sharpen a lookup, never break one.
 */
function shapedTimeQuery(text: string): string | null {
  const match = text
    .trim()
    .replace(/\?+\s*$/, "")
    .match(
      /^(?:(?:what|when)(?:'?s|\s+is)?|have\s+you\s+got|got|tell\s+me|do\s+you\s+know)?\s*(?:the\s+)?(?:(?:current|local|exact)\s+)*(time|clock|date|day)\s+(?:(?:is\s+it|now|currently)\s+)?(in|at|for)\s+(.+)$/i
    );

  if (match === null) {
    return null;
  }

  const place = match[3]
    .trim()
    .replace(/\s+(?:right\s+now|now|currently|today)$/i, "")
    .replace(/[.!?]+$/, "");

  if (place.length === 0 || place.length > 80) {
    return null;
  }

  const keyword = match[1].toLowerCase();
  const head = keyword === "date" || keyword === "day" ? "current date" : "current time";
  return `${head} ${match[2]} ${place}`;
}

/** Exported so the detection battery can verify intent classes directly. */
export function detectLiveIntent(userText: string): string | null {
  if (CHAT_GUARD.test(userText)) {
    return null;
  }

  /*
   * An EXPLICIT lookup verb ("look up", "google it") is a request on its own and
   * outranks every guard below: the person said what they want.
   */
  const explicitAsk = EXPLICIT_SEARCH_INTENT.test(userText);

  /*
   * A volatile subject only counts when the turn ASKS about it. A remark
   * ("prices are crazy these days") is chat, and arming it would ban the memory
   * answer on a turn that never needed the web.
   */
  const remark = COMMENTARY_GUARD.test(userText);
  const factQuestion =
    !remark && LIVE_FACT_DOMAINS.test(userText) && FACT_REQUEST_SHAPE.test(userText);
  /*
   * Current events need no domain word at all — "what's happening in Gaza"
   * names nothing from the list above, so it is matched by its own CATEGORY
   * shape rather than being added as yet another keyword.
   */
  const eventQuestion = !remark && CURRENT_EVENTS_INTENT.test(userText);
  const timeQuestion = isClockQuestion(userText);

  if (!explicitAsk && !factQuestion && !eventQuestion && !timeQuestion) {
    return null;
  }

  // A clock question is shaped to the exact lookup that answers with the time
  // ("What time is it in Tokyo?" → "current time in Tokyo"); every other
  // intent keeps the person's own words verbatim.
  const shaped = timeQuestion ? shapedTimeQuery(userText) : null;
  const query = (shaped ?? userText.trim()).slice(0, 140);
  return query.length >= 6 ? query : null;
}

/**
 * Deterministic output scrub for capability/provider leaks.
 *
 * The prompt forbids these sentences, but a prompt is a wish and this is the
 * floor: "I can't search", "according to my search", or any internal model /
 * service identifier in a SPOKEN reply makes Elara sound broken or exposes the
 * pipeline. A hit is rescued by the assist draft, else an honest canned line —
 * never the leaking text.
 */
const CAPABILITY_LEAK =
  /\b(?:can'?t|cannot|can\s*not|unable\s+to|don'?t\s+(?:even\s+)?have\s+(?:the\s+)?(?:ability|access)\s+to)\s+(?:search|look\s+(?:it\s+|things\s+)?up|browse|use\s+the\s+(?:internet|web|browser))\b|\b(?:according|based)\s+to\s+(?:my|the|a)\s+(?:quick\s+)?search\b|\bI\s+(?:just\s+)?searched\b|bright\s*data|assemblyai|gpt-oss|prompt-?guard|llama-?guard|qwen3|nemotron|universal-3[.\s-]?5|safeguard-20b|\[search:/i;

/**
 * Exported so the orchestrator can re-run the same scrub on the FINAL draft,
 * after Step 4 has had a chance to reintroduce a provider name or a marker.
 */
export function containsCapabilityLeak(text: string): boolean {
  return CAPABILITY_LEAK.test(text);
}

/** What this live lookup was actually waiting on. */
type LiveLookupKind = "time" | "weather" | "search";

/**
 * The ONE honest line for a live lookup that produced nothing.
 *
 * Contract: short, written in the LOCKED language, and it names no service. A
 * reply mentioning a provider exposes the pipeline and a reply in the wrong
 * language breaks the turn — both are impossible here, because this returns a
 * constant rather than a model output. "time" is deliberately its own line: if
 * the clock could not be read, "I won't guess" is the only truthful answer.
 *
 * The locker only ever locks a transcript to `en` or `bn`, and those are the two
 * languages with written twins; any other accepted lock falls back to the
 * English line rather than inventing a translation.
 */
function lookupUnavailableReply(
  language: ReplyLanguage,
  kind: LiveLookupKind
): string {
  if (language === "bn") {
    return kind === "time"
      ? TIME_UNAVAILABLE_REPLY_BN
      : kind === "weather"
        ? WEATHER_UNAVAILABLE_REPLY_BN
        : SEARCH_UNAVAILABLE_REPLY_BN;
  }

  return kind === "time"
    ? TIME_UNAVAILABLE_REPLY
    : kind === "weather"
      ? WEATHER_UNAVAILABLE_REPLY
      : SEARCH_UNAVAILABLE_REPLY;
}

/** Honest line when the lookup WORKED but the results could not be phrased. */
function synthesisFailedReply(language: ReplyLanguage): string {
  return language === "bn"
    ? SEARCH_SYNTHESIS_FAILED_REPLY_BN
    : SEARCH_SYNTHESIS_FAILED_REPLY;
}

/**
 * A clock turn, however it was raised.
 *
 * The person's own words are the primary signal, but a Bangla ask — or any
 * phrasing the English intent classes cannot read — arrives as the model's own
 * `[SEARCH: current time in …]` marker, so the RESOLVED query counts as the
 * person's request too, exactly as `lookupKindFor` already reads the query for
 * weather. Either way a clock turn must never be answered from memory, and the
 * synthesizer is told a stated time needs the timezone in the results.
 */
function isClockTurn(userText: string, searchQuery: string | null): boolean {
  return (
    isClockQuestion(userText) ||
    (searchQuery !== null && isClockQuestion(searchQuery))
  );
}

/**
 * Which honest line fits this turn: the clock, the weather, or a lookup.
 *
 * One helper so the reason is chosen in exactly one place — used both when a
 * lookup ran and returned nothing, and when there was nothing to look up with.
 */
function lookupKindFor(userText: string, searchQuery: string): LiveLookupKind {
  if (isClockTurn(userText, searchQuery)) {
    return "time";
  }

  return /weather|forecast|temperature|rain|degree/i.test(
    `${searchQuery} ${userText}`
  )
    ? "weather"
    : "search";
}

function toContents(
  history: BrainTurn[],
  userText: string
): GeminiContent[] {
  const contents: GeminiContent[] = conversationHistory(history).map(
    (turn) => ({
      role: turn.speaker === "you" ? "user" : "model",
      text: turn.text,
    })
  );

  contents.push({ role: "user", text: userText });
  return contents;
}

/** How many prior turns the main model may see. */
const HISTORY_WINDOW = 8;

/**
 * The history actually shown to a model.
 *
 * Canned lines are stripped HERE, on the server, as the authoritative filter: a
 * refusal or fallback message must never be replayed as an assistant turn,
 * because the model would treat it as an example of how to reply and converge on
 * refusals for ordinary small talk. The client filters too, but this is the
 * check that cannot be bypassed.
 */
function conversationHistory(history: BrainTurn[]): BrainTurn[] {
  return history
    .filter((turn) => turn.text.trim().length > 0 && !isCannedReply(turn.text))
    .slice(-HISTORY_WINDOW);
}

/* ──────────────────────────────────────────────────────────────────────────
   ANTI-ECHO — VARIETY WITHOUT ESSAYS
   ────────────────────────────────────────────────────────────────────────── */

/**
 * How many opening words count as "the same opener".
 *
 * Four is the shortest window that tells two real openers apart ("Pretty good,
 * actually —" vs "No way — that's") while being long enough that a single shared
 * word ("I", "That's") never looks like a repeat on its own.
 */
const ECHO_OPENER_WORDS = 4;

/** The opening words of `line`, folded so case and punctuation do not matter. */
function replyOpener(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\u2019\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, ECHO_OPENER_WORDS)
    .join(" ");
}

/** Elara's last really-spoken line in the visible history, or `null`. */
function lastAssistantLine(history: BrainTurn[]): string | null {
  const shown = conversationHistory(history);

  for (let index = shown.length - 1; index >= 0; index -= 1) {
    if (shown[index].speaker === "elara") {
      return shown[index].text.trim();
    }
  }

  return null;
}

/**
 * Does this reply start the same way as the one the person just heard?
 *
 * Deliberately narrow — one comparison of the first few words — because that is
 * what the ear notices ("she said 'That's a good question' again"). Everything
 * else about the reply is left alone.
 *
 * Exported so the anti-echo battery can verify the collision rule directly.
 */
export function echoesLastReply(reply: string, previous: string | null): boolean {
  if (previous === null) {
    return false;
  }

  const opener = replyOpener(reply);

  return opener.length > 0 && opener === replyOpener(previous);
}

/**
 * One bounded rewording call, used ONLY when a chat reply opened exactly like
 * the previous one.
 *
 * This is the deterministic half of "be varied": the prompt asks for fresh
 * wording, and this is the floor under it. The contract is deliberately tight —
 * same meaning, same length (1–3 short sentences), different opening — so the
 * fix for a repeated line is a re-worded line, never a longer one. A rewording
 * that fails any of the existing guards (canned, refusal, marker, provider leak,
 * wrong script) is discarded and the original reply is spoken unchanged, so this
 * can only ever improve variety, never break a turn.
 */
const ECHO_REPHRASE_SYSTEM = [
  "You are Elara, a warm, quick-witted friend talking out loud, rewording ONE",
  "line you are about to say because it starts the same way as your previous",
  "one. Keep the meaning and the warmth exactly. Keep it 1 to 3 short spoken",
  "sentences — never longer than the draft. Change the OPENING, not the content.",
  "No lists, no markdown, no emoji, no stage directions, no quotes.",
  "Reply with the reworded line only.",
].join(" ");

async function rephraseWithoutEcho(
  reply: string,
  previous: string,
  language: ReplyLanguage
): Promise<string | null> {
  const rewording = await groqChat({
    model: GROQ_MODELS.main,
    messages: [
      { role: "system", content: ECHO_REPHRASE_SYSTEM },
      {
        role: "user",
        content: [
          LANGUAGE_DIRECTIVES[language],
          `Your previous reply began: "${previous}"`,
          `Your draft now: "${reply}"`,
          `Say it again with a different opening — never start with "${replyOpener(previous)}".`,
        ].join("\n"),
      },
    ],
    // A touch hotter than the responder: the point of this call is a DIFFERENT
    // way of saying the same thing.
    temperature: 1,
    maxOutputTokens: BRAIN_TOKEN_BUDGETS.respond,
    timeoutMs: BRAIN_TIMEOUTS_MS.respond,
  });

  if (rewording === null) {
    return null;
  }

  const candidate = rewording.trim();

  if (
    !isSpeakableReply(candidate) ||
    isCannedReply(candidate) ||
    looksLikeRefusal(candidate) ||
    CAPABILITY_LEAK.test(candidate) ||
    !replyLanguageMatches(candidate, language) ||
    echoesLastReply(candidate, previous)
  ) {
    return null;
  }

  return candidate;
}

export interface RespondResult {
  reply: string;
  usedSearch: boolean;
  fastAssist: boolean;
  /**
   * Set when the deterministic output-side policy check replaced the reply
   * (credential-shaped text). The model's own answer never reaches the speaker.
   */
  policyBlocked: "secret" | "injection" | "hard-block" | null;
}

/**
 * Step 2 — one bounded assist call.
 *
 * Never throws, never waits longer than BRAIN_TIMEOUTS_MS.fastAssist (800 ms),
 * and returns `null` for `SKIP`, empty output, or a canned line. `null` is a
 * normal outcome: the assist only ever HELPS the main reply.
 */
async function stageFastAssist(
  userText: string,
  history: BrainTurn[]
): Promise<string | null> {
  const draft = await googleGenerate({
    model: GOOGLE_MODELS.fastAssist,
    system: FAST_ASSIST_SYSTEM,
    contents: toContents(history, userText),
    maxOutputTokens: BRAIN_TOKEN_BUDGETS.fastAssist,
    temperature: 0.4,
    timeoutMs: BRAIN_TIMEOUTS_MS.fastAssist,
  });

  if (draft === null) {
    return null;
  }

  const trimmed = draft.trim();

  // `SKIP` is the assist declaring itself useless, and a canned line must never
  // be recycled into a reply.
  return /^skip\b/i.test(trimmed) || isCannedReply(trimmed) ? null : trimmed;
}

export async function stageRespond(
  userText: string,
  history: BrainTurn[],
  language: ReplyLanguage = "en",
  emotion: EmotionHint | null = null
): Promise<RespondResult> {
  /*
   * Too-thin transcript (a breath, a stray character): clarify in the locked
   * language instead of sending noise to the models — the Language Locker's
   * "clarify, never guess" rule, enforced at the boundary.
   */
  if (isLowConfidenceTranscript(userText)) {
    return {
      reply: clarifyLine(language),
      usedSearch: false,
      fastAssist: false,
      policyBlocked: null,
    };
  }

  /*
   * The person's own words are classified ONCE, before any model call: the same
   * verdict arms the backup lookup, decides whether a live turn may ever fall
   * back to the model's memory, and short-circuits the turn when there is
   * nothing to look up with.
   */
  const intentQuery = detectLiveIntent(userText);
  const asksForLiveFacts = intentQuery !== null;

  /*
   * NOTHING TO LOOK UP WITH.
   *
   * With no Bright Data credentials the lookup cannot be attempted at all. When
   * the person asked for live facts anyway, the model's answer would be a guess
   * wearing the clothes of news — an invented temperature, an invented score, an
   * invented clock time. So the turn gets the same ONE honest line a failed
   * lookup gets, and no model is asked about it.
   *
   * Pure chat never reaches this branch: `asksForLiveFacts` is false for
   * greetings, feelings, jokes, opinions, and anything about the two of us.
   */
  if (asksForLiveFacts && !isBrightDataConfigured()) {
    // Server-side diagnosis: this branch skips Bright Data entirely — no
    // request ever reaches the dashboard. Logged, never returned to a client.
    console.log(
      "[serp]",
      JSON.stringify({ configured: false, attempted: false, reason: "not-configured" })
    );
    return {
      reply: lookupUnavailableReply(language, lookupKindFor(userText, userText)),
      usedSearch: false,
      fastAssist: false,
      policyBlocked: null,
    };
  }

  const messages: GroqMessage[] = [
    { role: "system", content: systemPrompt(language, emotion) },
    ...conversationHistory(history).map((turn) => ({
      role: turn.speaker === "you" ? ("user" as const) : ("assistant" as const),
      content: turn.text,
    })),
    { role: "user", content: userText },
  ];

  // Steps 2 and 3 in flight together. The assist is capped at 800 ms, so a turn
  // completes at max(main, assist) — a bounded fraction of a second, never an
  // open-ended wait on Google.
  const [mainReply, assistDraft] = await Promise.all([
    groqChat({
      model: GROQ_MODELS.main,
      messages,
      temperature: 0.8,
      maxOutputTokens: BRAIN_TOKEN_BUDGETS.respond,
      timeoutMs: BRAIN_TIMEOUTS_MS.respond,
    }),
    stageFastAssist(userText, history),
  ]);

  /*
   * ROOT CAUSE OF THE "Dhaka" DEAD-END, FIXED HERE.
   *
   * `[SEARCH: …]` is a pipeline instruction, not speech — but it must be
   * resolved BEFORE the speakability filter. The old order judged the marker
   * reply unspeakable first (`isSpeakableReply` rejects any text containing a
   * marker), `reply` stayed null, the stage threw, and the catch-all spoke the
   * generic "couldn't think that through" line — with the search never attempted.
   * Now the marker is detected on the RAW main reply, Bright Data runs, and the
   * follow-up (or an honest short fallback) is what gets spoken.
   */
  const rawMain = typeof mainReply === "string" ? mainReply : null;

  /*
   * TWO ways a turn reaches Bright Data — both handled BEFORE speakability:
   *
   *  1. The model emitted `[SEARCH: …]` (primary, trained by the prompt).
   *  2. The SERVER detected live intent in the person's own words (backup), for
   *     when the model answered from memory instead — the "knowledge guess"
   *     half of the live bug. Armed only when Bright Data is configured; when
   *     it is NOT, a live ask is answered by the honest line before any model
   *     call at all (see the early return above).
   *
   * Intent, not keywords: `detectLiveIntent` reads freshness domains, clock
   * questions and explicit lookup verbs behind a chat guard — never a fixed
   * city or entity list. When a lookup produces NOTHING — whether the ask
   * came in the person's own words or as the model's own marker — memory is
   * banned and the turn gets one honest line
   * in the locked language — no invented weather, news, score, price or time.
   */
  const markerQuery = rawMain === null ? null : findSearchQuery(rawMain);
  const searchQuery =
    markerQuery ?? (isBrightDataConfigured() ? intentQuery : null);
  /** True when the MODEL asked for this lookup by emitting a marker. */
  const markerTurn = markerQuery !== null;

  let reply: string | null = null;
  let fastAssist = false;
  let usedSearch = false;

  if (searchQuery !== null) {
    /*
     * THE DETAILED OUTCOME, not a collapsed text-or-nothing.
     *
     * `serpSearch` folds "no credentials", "the provider answered with nothing",
     * "the provider is unhappy" and "the fetch timed out" into one `null`, which
     * made every live failure look identical from here — and hid the difference
     * between a genuinely empty SERP and a transient gateway reject. This call
     * keeps the class, so the per-kind honest line below is chosen with the real
     * reason behind it, and a flaky lookup is diagnosable from the server log
     * without ever surfacing a provider name to the speaker.
     */
    let results: string | null = null;
    let outcome: SerpResult | null = null;

    if (isBrightDataConfigured()) {
      outcome = await serpSearchDetailed(searchQuery, BRAIN_TIMEOUTS_MS.search);
      results = outcome.kind === "ok" ? outcome.results : null;
    } else {
      // The model raised a marker but the credentials are gone — record it.
      console.log(
        "[serp]",
        JSON.stringify({
          configured: false,
          attempted: false,
          reason: "marker-without-credentials",
        })
      );
    }
    usedSearch = results !== null;

    /*
     * WHAT MAY BE ANSWERED FROM MEMORY — AND WHAT MAY NOT.
     *
     * `results === null` means the lookup produced nothing at all: no
     * credentials, a provider error, or a genuinely empty result set. For any
     * turn that needed live facts, memory is BANNED outright:
     *
     *   - the person asked for live facts (`asksForLiveFacts` — weather, news,
     *     scores, prices, the time anywhere, "what's happening now", …), and
     *   - the person asked about the CLOCK (`isClockTurn` — their own words, or
     *     the English-shaped query the model's marker resolved to), where memory
     *     can only ever produce an invented time.
     *
     * All of them hear ONE honest line in the locked language instead. That is
     * the whole difference between a companion who says "I can't check right
     * now" and one who invents tomorrow's forecast — and it holds with Bright
     * Data unconfigured, which is exactly where the invented weather came from.
     *
     * The MODEL's own marker counts the same way: emitting `[SEARCH: …]` IS the
     * model saying this turn needs current facts — the prompt trains the marker
     * for exactly that — so a marker turn with no usable results hears the
     * honest canned line too. It used to fall through to a from-memory answer,
     * which is where a failed lookup could still fabricate a number, time,
     * score or story for wording no detector class covered.
     */
    const memoryBanned =
      results === null &&
      (markerTurn || asksForLiveFacts || isClockTurn(userText, searchQuery));

    if (memoryBanned) {
      /*
       * Server-side diagnosis for the honest line: WHICH class of failure
       * produced it, and whether it was a clock turn. Carries only the outcome
       * class and the kind — never the query text, results or body — so the
       * "flaky live search" report can be read straight off the log while the
       * speaker hears nothing but the honest line.
       */
      console.log(
        "[serp]",
        JSON.stringify({
          attempted: outcome !== null,
          outcome: outcome === null ? "not-attempted" : outcome.kind,
          kind: lookupKindFor(userText, searchQuery),
          memoryBanned: true,
        })
      );

      reply = lookupUnavailableReply(
        language,
        lookupKindFor(userText, searchQuery)
      );
    } else if (results !== null) {
      /*
       * GROUNDED REPLY — snippets only, one to three short spoken sentences.
       *
       * `results === null` can never land here (memoryBanned above caught it),
       * so this call always has real snippets in hand and the instruction pins
       * fresh facts to them: anything the results do not show is left out, not
       * guessed — no invented number, time, score, price or headline.
       */
      const grounded = await groqChat({
        model: GROQ_MODELS.main,
        messages: [
          ...messages,
          ...(rawMain !== null ? [{ role: "assistant" as const, content: rawMain }] : []),
          {
            role: "user",
            content: [
              "Web search results (may be incomplete):",
              results,
              "",
              `The person said: "${userText}"`,
              "Answer in your own voice, in one to three short spoken sentences.",
              "Ground every current fact — number, time, temperature, score,",
              "price, news detail — in these results alone: if they do not show",
              "it, leave it out rather than guessing. Same language as your",
              "replies. Never mention searching, sources or tools.",
              ...(isClockTurn(userText, searchQuery)
                ? [
                    "This is a clock question: state a time ONLY if the results",
                    "clearly show it for the place asked, with its timezone.",
                    "If they do not, say you cannot check the clock right now -",
                    "never guess a time.",
                  ]
                : []),
            ].join("\n"),
          },
        ],
        temperature: 0.8,
        maxOutputTokens: BRAIN_TOKEN_BUDGETS.respond,
        timeoutMs: BRAIN_TIMEOUTS_MS.respond,
      });

      if (isSpeakableReply(grounded) && !looksLikeRefusal(grounded)) {
        reply = grounded;
      }
    }

    if (reply === null && assistDraft !== null && !looksLikeRefusal(assistDraft)) {
      reply = assistDraft;
      fastAssist = true;
    }

    if (reply === null) {
      /*
       * Honest, short fallback — NEVER the generic dead-end, NEVER the raw
       * marker and NEVER a provider name. A lookup that succeeded but could not
       * be phrased gets the "found something" line; a lookup that produced
       * nothing gets the in-language unavailable line for its kind.
       */
      reply =
        results !== null
          ? synthesisFailedReply(language)
          : lookupUnavailableReply(language, lookupKindFor(userText, searchQuery));
    }
  } else {
    reply = isSpeakableReply(rawMain) ? rawMain : null;

    /*
     * Rescue. The input guard already cleared this message, so a refusal here
     * is drift rather than policy — and a spoken refusal is what poisons the
     * turns that follow. When the assist drafted something usable, that is what
     * gets said instead. Whatever text is chosen still passes Step 5.
     */
    if (reply === null || looksLikeRefusal(reply)) {
      if (assistDraft !== null && !looksLikeRefusal(assistDraft)) {
        reply = assistDraft;
        fastAssist = true;
      }
    }

    /*
     * A refusal that survived the rescue is still drift, not policy — nothing
     * here had a reason to decline (the deterministic gate and Step 1 both
     * cleared this message). Speak a CANNED line instead: canned lines are
     * stripped from the history on BOTH sides, so one decline can never teach
     * the model to refuse the next ordinary message. The model's own refusal
     * text is therefore never stored as an assistant turn.
     */
    if (reply !== null && looksLikeRefusal(reply)) {
      reply = language === "bn" ? BRAIN_UNAVAILABLE_BN : SAFE_FALLBACK_REPLY;
    }

    if (reply === null) {
      throw new Error("respond-failed");
    }
  }

  /*
   * ANTI-ECHO, CHAT ONLY.
   *
   * The person is talking to a friend, not reading a template, and the prompt's
   * "never open two replies the same way" is a wish. This is the floor: when a
   * chat reply opens with exactly the same few words as the reply they just
   * heard, ONE bounded rewording call is made, and it is accepted only if it
   * clears every guard already in this function. Anything less than that is the
   * original reply, unchanged.
   *
   * Search-grounded replies are deliberately excluded: the wording there carries
   * facts (a time, a temperature, a score) that a rewording pass could blur, and
   * a live answer is already fresh by construction.
   */
  const previousLine = lastAssistantLine(history);

  if (
    previousLine !== null &&
    !usedSearch &&
    !isCannedReply(reply) &&
    echoesLastReply(reply, previousLine)
  ) {
    const reworded = await rephraseWithoutEcho(reply, previousLine, language);

    if (reworded !== null) {
      reply = reworded;
    }
  }

  /*
   * Output-side credential check. The model has no access to this server's
   * environment, but it can invent a plausible-looking key — and an invented
   * key spoken aloud is indistinguishable from a real leak. Fail CLOSED: the
   * whole reply is replaced by the short spoken refusal.
   */
  if (containsCredentialLikeText(reply)) {
    return {
      reply:
        policyReplyFor("secret") ?? "I don't hand out keys. Ask me something else?",
      usedSearch,
      fastAssist,
      policyBlocked: "secret",
    };
  }

  /*
   * Deterministic capability/provider-leak scrub — the floor under the prompt's
   * "never say you can't search, never name a service" rules. A leaking reply
   * is replaced wholesale: first by the assist draft (if clean), else by the
   * honest canned line for this turn's situation. The leaking text never
   * reaches the speaker, and no provider name or model id can be spoken.
   */
  if (!isCannedReply(reply) && CAPABILITY_LEAK.test(reply)) {
    if (
      assistDraft !== null &&
      !looksLikeRefusal(assistDraft) &&
      !CAPABILITY_LEAK.test(assistDraft)
    ) {
      reply = assistDraft;
      fastAssist = true;
    } else {
      return {
        reply: usedSearch
          ? SEARCH_SYNTHESIS_FAILED_REPLY
          : language === "bn"
            ? SEARCH_UNAVAILABLE_REPLY_BN
            : SEARCH_UNAVAILABLE_REPLY,
        usedSearch,
        fastAssist,
        policyBlocked: null,
      };
    }
  }

  /*
   * Full-turn language guard (script level). Canned fallback lines are
   * exempt: they are already-final honest answers. A model reply in the wrong
   * SCRIPT is the visible Bangla bug, so it is replaced by an in-language line
   * rather than spoken as-is.
   */
  if (!isCannedReply(reply) && !replyLanguageMatches(reply, language)) {
    return {
      reply: language === "bn" ? BRAIN_UNAVAILABLE_BN : SAFE_FALLBACK_REPLY,
      usedSearch,
      fastAssist,
      policyBlocked: null,
    };
  }

  return { reply, usedSearch, fastAssist, policyBlocked: null };
}

