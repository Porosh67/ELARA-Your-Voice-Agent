import "server-only";

import {
  BRAIN_TIMEOUTS_MS,
  BRAIN_TOKEN_BUDGETS,
  GOOGLE_MODELS,
  GROQ_MODELS,
} from "@/lib/brain/models";
import { googleGenerate } from "@/lib/brain/providers/google";
import { groqChat } from "@/lib/brain/providers/groq";
import { isGoogleAiConfigured, isGroqConfigured } from "@/lib/brain/env";
import type { BrainTurn } from "@/lib/brain/types";

/**
 * THE MEANING-BASED ROUTER — decides CHAT vs LIVE for ANY topic, in ANY
 * language, with no keyword list anywhere.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The deterministic regex router that preceded it could only recognise the
 * topics someone thought to write a pattern for. Anything outside that set fell
 * through to CHAT, so a genuinely live question about a subject nobody listed
 * was answered from memory — which is the one failure this pipeline must never
 * have. A small fast model reads the MEANING of the turn instead, so the
 * coverage is the model's, not a hand-maintained list's.
 *
 * ── WHY IT CANNOT MISFIRE INTO A SEARCH ──────────────────────────────────────
 *
 * Three properties, in order of importance:
 *
 *   1. IT DEFAULTS TO CHAT. Every failure — no key, timeout, unparseable JSON,
 *      a missing field, an unknown route, a query that is empty or absurdly
 *      long — resolves to `null`, and the caller keeps the deterministic
 *      router's answer. LIVE is only ever reached on a CONFIDENT, well-formed
 *      `{"route":"live","query":"..."}`.
 *   2. IT IS A HINT, NOT A VERDICT. A `live` answer is only allowed to PROMOTE
 *      a turn the deterministic router left at `chat`/`ambiguous`, and only
 *      when it also supplies a usable query. It can never demote a `block`
 *      (the safety gate is not the classifier's to touch) and never overrides
 *      a deterministic LIVE.
 *   3. IT IS BOUNDED. 1200 ms, 120 output tokens, ~8 turns of context, and it
 *      runs concurrently with the input guard rather than in front of it.
 *
 * The query it returns must STAND ALONE: the person said "what about
 * tomorrow?" and the search engine needs "weather in Dhaka tomorrow", so the
 * model is asked to resolve anaphora against the context it is given.
 */

/** What the model is asked to return, and the only two routes that exist. */
export type SemanticRouteKind = "chat" | "live";

export interface SemanticRoute {
  kind: SemanticRouteKind;
  /** LIVE only: a standalone search query. Never spoken, never logged. */
  query: string | null;
  /** True when the answer came from a well-formed model reply. */
  confident: boolean;
}

const ROUTER_SYSTEM = [
  "You route a voice assistant's turns. Answer ONLY with a JSON object.",
  "",
  'Answer exactly: {"route":"chat","query":""} or {"route":"live","query":"<query>"}',
  "",
  'Choose "live" when answering correctly needs facts that CHANGE OVER TIME or',
  "POST-DATE your training — anything a stale model would get wrong:",
  "- the current weather, temperature or forecast for any place",
  "- news, headlines, anything that happened or was announced recently",
  "- current sport results, standings, rankings, awards, records",
  "- prices, costs, exchange rates, market values, salaries, statistics",
  "- the current time, date, day or countdown for any place",
  "- who currently holds a public office or role, and current job listings",
  "- who is currently the top, best, leading, biggest or most popular X right now",
  "- anything released, published, appointed, elected or updated recently",
  "- schedules, timetables, opening hours, availability, traffic, delays",
  "- the general state of a country, region, city or the world right now",
  "",
  "When you are unsure whether something ages, ask: would a model with no",
  "internet and no idea what today's date be likely to get this WRONG? If yes,",
  'answer "live". A vague noun is not on its own a reason to stay in "chat":',
  '"the top superstar in India" names a present-day ranking even though it names',
  "no particular person. Weigh that against the false-premise rule below.",
  "",
  'Choose "chat" for everything else:',
  "- timeless knowledge: science, history, maths, definitions, how things work",
  "- opinions, advice, feelings, banter, small talk, greetings, jokes, stories",
  "- creative requests: write, tell, make up, suggest, translate, summarise",
  '- "another one", "something new", "tell me another" about THIS conversation',
  "- a follow-up about something already discussed that is not time-sensitive",
  "- false premises and trick questions: answer the real question, don't search",
  "",
  "Judge by MEANING, not by keywords, and in ANY language — Bangla, Banglish",
  "(romanised Bangla) and English are all routed the same way. Never match on a",
  "word alone: a joke about the weather is chat; a real forecast question is live.",
  "",
  "A FALSE PREMISE is never live, however current-sounding it is. If the thing",
  "asked about does not exist — there is no first president of Tokyo, no mayor of",
  "Atlantis, no capital of Narnia — then no search can answer it, so the person",
  "wants the premise corrected, not a lookup. A superlative (\"top\", \"best\",",
  '"leading", "most famous") is about the CURRENT scene ONLY when it asks about',
  "right now; \"who was the first president of Tokyo?\" is history-shaped and",
  "false at the same time, and stays chat.",
  "",
  'When you answer "live", the query must STAND ALONE for a search engine:',
  "resolve pronouns and references against the conversation, name the subject",
  "and the place, and keep it short. If the person asked 'what about tomorrow?'",
  "right after asking about Dhaka weather, the query is the Dhaka weather for",
  "tomorrow — not 'what about tomorrow'.",
  "",
  "Never answer with anything except the JSON object.",
].join("\n");

/** How many prior turns the router may read for anaphora resolution. */
const ROUTER_CONTEXT_TURNS = 8;

/** A query outside this range is nonsense, not a search. */
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 140;

/**
 * Pull a JSON object out of a model reply, tolerantly.
 *
 * JSON mode normally returns clean JSON, but a model can still wrap it in a
 * fence or a sentence, so the first brace-balanced object is taken. Any parse
 * failure returns `null` — an unreadable answer is never guessed at.
 */
function parseRouterJson(raw: string): unknown {
  const text = raw.trim();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // fall through to the tolerant scan
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/** The CHAT answer — a real verdict, as opposed to no answer at all. */
function chatRoute(): SemanticRoute {
  return { kind: "chat", query: null, confident: false };
}

/**
 * Read the model's reply into a route, or `null` when there was NO answer.
 *
 * The distinction matters because there are two providers to try. A CHAT
 * verdict is a decision and is returned immediately; only a missing, empty or
 * unreadable reply is a failure, and only a failure falls through to the next
 * provider. Collapsing the two would send every greeting to Groq for nothing.
 *
 * A `live` verdict is only ever CONFIDENT with a usable query: a missing field,
 * an unknown route word, or an empty or oversized query is not an answer.
 */
function readRoute(raw: string | null): SemanticRoute | null {
  if (raw === null) {
    return null;
  }

  const parsed = parseRouterJson(raw);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as { route?: unknown; query?: unknown };

  const query = typeof record.query === "string" ? record.query.trim() : "";
  const queryUsable =
    query.length >= MIN_QUERY_LENGTH && query.length <= MAX_QUERY_LENGTH;

  if (record.route === "chat") {
    /*
     * A CHAT verdict that still carries a real query is the model doing exactly
     * what it was asked — it found the turn ambiguous and wrote the search it
     * would need. Measured live: "Can you tell me the top superstar name in
     * India?" came back as {"route":"chat","query":"Who is the top superstar in
     * India?"}. Treating that as a plain chat sent a question about the current
     * scene to a model with no idea what year it is, and it confidently named
     * an actor. An unusable or empty query is still just chat.
     */
    return queryUsable ? { kind: "live", query, confident: true } : chatRoute();
  }

  if (record.route === "live") {
    return queryUsable ? { kind: "live", query, confident: true } : chatRoute();
  }

  return null;
}

/**
 * Ask the fast model what this turn MEANS.
 *
 * Two providers, tried in order, because this stage decides CORRECTNESS and not
 * just latency: it fails open to CHAT, so a provider that is slow or down sends
 * every live question back to a model with no idea what today's date is. That is
 * exactly the "sometimes it searches, sometimes it doesn't" symptom.
 *
 * Measured on the live endpoints, the same classification takes 0.6 s or 6.0 s
 * on Google depending on nothing the caller controls, and Groq answers the same
 * prompt in about a second. So Google leads (it is the cheaper, faster model
 * when healthy) and Groq catches whatever Google cannot answer in time. The
 * budgets are split so the pair cannot exceed one router budget in total.
 *
 * Returns `null` when no answer could be had at all — the caller then relies
 * purely on the deterministic router.
 */
export async function classifyTurnSemantics(
  userText: string,
  history: BrainTurn[]
): Promise<SemanticRoute | null> {
  const recent = history.slice(-ROUTER_CONTEXT_TURNS);
  const googleContents: { role: "user" | "model"; text: string }[] = recent.map((turn) => ({
    role: turn.speaker === "you" ? "user" : "model",
    text: turn.text,
  }));
  googleContents.push({ role: "user", text: userText });

  // ── Attempt 1: Google AI Studio ──
  if (isGoogleAiConfigured()) {
    const raw = await googleGenerate({
      model: GOOGLE_MODELS.router,
      system: ROUTER_SYSTEM,
      contents: googleContents,
      maxOutputTokens: BRAIN_TOKEN_BUDGETS.router,
      temperature: 0,
      timeoutMs: BRAIN_TIMEOUTS_MS.router,
      responseMimeType: "application/json",
    });

    const route = readRoute(raw);

    if (route !== null) {
      return route;
    }
  }

  // ── Attempt 2: Groq, on whatever Google could not answer in time ──
  //
  // Only reached when Google was unconfigured, timed out, or answered with
  // something unreadable. A CHAT verdict from attempt 1 is a real answer and
  // has already been returned above.
  if (isGroqConfigured()) {
    const groqMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: ROUTER_SYSTEM },
    ];

    for (const turn of recent) {
      groqMessages.push({
        role: turn.speaker === "you" ? "user" : "assistant",
        content: turn.text,
      });
    }

    groqMessages.push({ role: "user", content: userText });

    const raw = await groqChat({
      model: GROQ_MODELS.router,
      messages: groqMessages,
      maxOutputTokens: BRAIN_TOKEN_BUDGETS.router * 2,
      temperature: 0,
      timeoutMs: BRAIN_TIMEOUTS_MS.router,
    });

    return readRoute(raw);
  }

  return null;
}
