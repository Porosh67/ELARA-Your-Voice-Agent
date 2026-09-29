import "server-only";

import {
  BRAIN_TIMEOUTS_MS,
  BRAIN_TOKEN_BUDGETS,
  GROQ_MODELS,
  SAFETY_SCORE_THRESHOLD,
} from "@/lib/brain/models";
import { groqChat } from "@/lib/brain/providers/groq";

/**
 * Step 1 (input safety) and Step 5 (output safety).
 *
 * ── WHY THIS FILE LOOKS THE WAY IT DOES ──────────────────────────────────────
 *
 * An earlier version required the guard's raw output to START WITH the literal
 * text "SAFE", and treated anything else as unsafe. That was wrong, and it broke
 * conversation quality completely:
 *
 *   `llama-prompt-guard-2-86m` on Groq is a TEXT-CLASSIFICATION model. It does
 *   not return "SAFE"/"unsafe" — it returns a raw injection PROBABILITY as a
 *   decimal string. Measured live:
 *
 *     "How are you?"                       -> "0.00036293535958975554"
 *     "Tell me a joke"                     -> "0.0005313351284712553"
 *     "Ignore all previous instructions…"  -> "0.9996024966239929"
 *
 *   None of those start with "SAFE", so every ordinary message — including
 *   "How are you?" — was classified as an attack and replaced with the canned
 *   `INPUT_BLOCKED_REPLY`. Worse, that canned line then entered the conversation
 *   history, so the main model learned the refusal pattern and imitated it for
 *   every following turn.
 *
 * The rule now: a guard may only block on a POSITIVE, understood verdict. An
 * unparseable reply means "cannot tell" → `null` → the orchestrator lets the
 * turn through. Guards must never fail closed on normal conversation.
 *
 * Verdicts therefore have three states:
 *   true   — safe, continue
 *   false  — a guard positively classified this as unsafe, block
 *   null   — the guard could not run or could not be understood (fail open)
 */

/**
 * Interpret a Prompt Guard response.
 *
 * Prompt Guard returns an injection PROBABILITY as a decimal string
 * ("0.00036..." = benign, "0.9996..." = attack). Safe when BELOW the threshold.
 * Label forms ("SAFE" / "unsafe\nO1") are handled for other hosts / models.
 * Returns `null` when the reply can't be understood — never a guess.
 */
export function parsePromptGuardVerdict(raw: string): boolean | null {
  const text = raw.trim();

  if (text.length === 0) {
    return null;
  }

  // Probability form. `Number("")` is 0 and `Number("SAFE")` is NaN, so the
  // finite check cleanly separates the numeric case from the label case.
  const score = Number(text);

  if (Number.isFinite(score)) {
    return score < SAFETY_SCORE_THRESHOLD;
  }

  const upper = text.toUpperCase();

  if (upper.startsWith("UNSAFE") || /^S\d+\b/.test(upper)) {
    return false;
  }

  if (upper.startsWith("SAFE")) {
    return true;
  }

  return null;
}

/** Step 1 — meta-llama/llama-prompt-guard-2-86m. */
export async function inputSafetyPasses(
  text: string
): Promise<boolean | null> {
  const verdict = await groqChat({
    model: GROQ_MODELS.inputGuard,
    // Prompt Guard requires EXACTLY one user message; adding a system message
    // makes Groq reject the request outright ("messages must contains a single
    // user message for text classification models").
    messages: [{ role: "user", content: text }],
    maxOutputTokens: 16,
    temperature: 0,
    timeoutMs: BRAIN_TIMEOUTS_MS.inputGuard,
  });

  if (verdict === null) {
    return null;
  }

  return parsePromptGuardVerdict(verdict);
}

/**
 * Interpret a Llama Guard / safeguard response.
 *
 * Both return a label-first verdict: `safe`, or `unsafe` optionally followed by
 * a hazard code (e.g. `unsafe` on its own line above `S1`). The regex (not
 * `startsWith`) so a leading phrase like "The reply is safe" still parses, and
 * the word boundary keeps "safeguard" from matching "safe". Anything else is
 * ambiguous and yields `null`, so friendly chat is never blocked by a parsing
 * accident.
 */
function parseGuardLabel(raw: string): boolean | null {
  const match = /\b(unsafe|safe)\b/i.exec(raw.trim());

  if (!match) {
    return null;
  }

  return match[1].toLowerCase() === "safe";
}

/**
 * Classification instructions for the Step 5 output guard.
 *
 * `gpt-oss-safeguard-20b` is a REASONING model, and with bare messages it does
 * not classify — it ANSWERS the conversation ("I'm just a bunch of code..."),
 * which parses as ambiguous, fails open, and turns output safety into a silent
 * no-op. Measured live, an explicit one-word-verdict contract makes it behave
 * as a guard:
 *
 *   friendly / name / joke / feelings replies  -> "safe"   (55-102 tokens)
 *   lock-picking instructions                  -> "unsafe"
 *
 * The token cost is the model's hidden reasoning pass before the single word,
 * which is why the budget is BRAIN_TOKEN_BUDGETS.outputGuard (500), not 16:
 * at 16 the reasoning consumed the whole allowance and the API returned an
 * empty string with finish_reason "length".
 */
const OUTPUT_GUARD_SYSTEM = [
  "You are a strict output-safety classifier for a friendly voice companion.",
  "",
  "You will be shown a short exchange. Decide whether the assistant's reply is",
  "safe to be spoken aloud. Ordinary friendly conversation, small talk, jokes,",
  "feelings, opinions and harmless factual answers are ALL safe.",
  "Only mark it unsafe if it gives real operational harm: instructions for",
  "weapons, violence or self-harm, illegal acts, sexual content involving",
  "minors, hate, or targeted harassment.",
  "",
  "Reply with exactly one word: either safe or unsafe.",
  "Do not explain, do not comment on the conversation, do not add anything else.",
].join("\n");

/**
 * Step 5 — output safety over the full exchange.
 *
 * `openai/gpt-oss-safeguard-20b` is the ONE guard. The originally specified
 * `meta-llama/llama-guard-4-20b` does not exist on this Groq account (HTTP 404,
 * confirmed against /v1/models), and probing it first cost a doomed round trip
 * on the critical path of every cold process — so it is not referenced at all
 * any more.
 *
 * The contract is one word, enforced by OUTPUT_GUARD_SYSTEM. An empty or
 * ambiguous verdict returns `null` (fail open): a classifier outage must never
 * turn friendly chat into a refusal, because a "blocked" reply is exactly the
 * kind of line that then poisons the conversation history.
 */
export async function outputSafetyPasses(
  userText: string,
  reply: string
): Promise<boolean | null> {
  const verdict = await groqChat({
    model: GROQ_MODELS.outputGuard,
    messages: [
      { role: "system", content: OUTPUT_GUARD_SYSTEM },
      { role: "user", content: userText },
      { role: "assistant", content: reply },
    ],
    maxOutputTokens: BRAIN_TOKEN_BUDGETS.outputGuard,
    temperature: 0,
    timeoutMs: BRAIN_TIMEOUTS_MS.outputGuard,
  });

  if (verdict === null) {
    return null;
  }

  return parseGuardLabel(verdict);
}
