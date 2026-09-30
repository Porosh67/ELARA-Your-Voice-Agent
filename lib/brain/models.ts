/**
 * LOCKED MODEL REGISTRY — the Main Brain.
 *
 * Every model identifier lives here and nowhere else, so the architecture can
 * be audited against the locked spec at a glance. The step numbers below are the
 * locked five critical-path steps, not an internal stage counter:
 *
 *   Step 1  input safety    llama-prompt-guard-2-86m   (Groq)
 *   Step 2  fast assist     Gemini 3.5 Flash Lite      (Google AI Studio)
 *   Step 3  main response   gpt-oss-120b               (Groq)
 *   Step 4  reorganize      qwen3.8-27b                (Groq)
 *   Step 5  output safety   gpt-oss-safeguard-20b      (Groq)
 *
 *   Search:          Bright Data SERP (optional — inert without a token)
 *   Step 4 fallback: nemotron-3-nano                   (Ollama Cloud)
 *   Background:      Gemini Embedding 2, gemma-4-31b-it, nemotron-3-nano
 */
export const GROQ_MODELS = {
  /** Step 1 — input safety. A text-classification model: it returns a raw
   *  probability, not a label (see `stages/safety.ts`). */
  inputGuard: "meta-llama/llama-prompt-guard-2-86m",
  /** Step 3 — main reasoning + response. The responder, always. */
  main: "openai/gpt-oss-120b",
  /** Step 4 — reorganize + emotion (tone polish only). */
  reorganize: "qwen/qwen3.8-27b",
  /**
   * Step 5 — output safety. The ONE output guard.
   *
   * The earlier entry here was `meta-llama/llama-guard-4-20b`, which does not
   * exist on this Groq account — it answers HTTP 404, confirmed live against
   * /v1/models. Because the pipeline probed it before falling back, every cold
   * process spent a doomed round trip on the critical path. It is no longer
   * referenced at all. `openai/gpt-oss-safeguard-20b` is a 20B safety model that
   * behaves as a guard once it is given the explicit one-word verdict contract
   * in `stages/safety.ts` (measured: friendly replies → "safe", lock-picking
   * instructions → "unsafe").
   */
  outputGuard: "openai/gpt-oss-safeguard-20b",
  /**
   * The SECOND attempt at the meaning-based router, used only when Google AI
   * cannot answer in time. It is a reasoning model, so it reasons before it
   * emits the JSON — the budget leaves room for that.
   */
  router: "openai/gpt-oss-120b",
} as const;

/**
 * Decision boundary for `llama-prompt-guard-2-86m`.
 *
 * That model returns an injection PROBABILITY as a decimal string, so a raw
 * comparison is the correct reading. 0.5 is the conventional decision boundary;
 * measured legitimate chat scores ~0.0004 and a real injection attempt scored
 * 0.9996, so the gap is enormous and the exact value is not delicate.
 */
export const SAFETY_SCORE_THRESHOLD = 0.5;


export const GOOGLE_MODELS = {
  /** Step 2 — fast assist draft. Hard-capped at 800 ms and fired alongside the
   *  main model, so it can never hold the voice loop open. */
  fastAssist: "gemini-3.5-flash-lite",
  /**
   * The MEANING-based router. Same configured model as the assist (no new
   * model id, no new key): it decides CHAT vs LIVE from what the turn MEANS in
   * any language, which is what lets ELARA cover any topic without a keyword
   * list. Runs concurrently with the input guard, hard-capped, and defaults to
   * CHAT on any failure so it can never arm a search by accident.
   */
  router: "gemini-3.5-flash-lite",
  /** Background — memory embeddings. */
  embedding: "gemini-embedding-2",
  /** Background — quality check. */
  quality: "gemma-4-31b-it",
} as const;

export const OLLAMA_MODELS = {
  /** Step 4 fallback when Qwen fails. */
  reorganizeFallback: "nemotron-3-nano",
  /** Background — long-context summaries. */
  longContext: "nemotron-3-nano",
} as const;

/**
 * Per-stage token budgets.
 *
 * ── WHY THESE ARE LARGE ──────────────────────────────────────────────────────
 *
 * `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` and `openai/gpt-oss-safeguard-20b`
 * are REASONING models: hidden reasoning tokens are billed against
 * `max_completion_tokens` BEFORE any visible content is produced. Measured live
 * on this account for a one-line reply:
 *
 *     gpt-oss-safeguard-20b, "How are you?"  -> reasoning 212, content 0 @ 64 tok
 *     gpt-oss-safeguard-20b, "I'm feeling sad" -> reasoning 305, content 0 @ 64 tok
 *     openai/gpt-oss-120b (short reply)      -> reasoning ~300
 *
 * With the previous budgets (300 for the responder, 200 for the rewrite, 16 for
 * the output guard) the reasoning alone consumed the whole allowance, so the API
 * returned an EMPTY content string with `finish_reason: "length"`. An empty reply
 * was then read as "the model failed" and replaced by a canned line — which is
 * why almost every utterance produced the same non-answer. These budgets leave
 * room for the reasoning pass AND the spoken sentence after it.
 */
export const BRAIN_TOKEN_BUDGETS = {
  /** Classification model: emits a bare probability, no reasoning pass. */
  inputGuard: 16,
  /** Reasoning headroom + up to three short spoken sentences. */
  respond: 1500,
  /** Fast assist is a small non-reasoning model. */
  fastAssist: 400,
  /** The router emits a two-field JSON object; a small budget is plenty. */
  router: 120,
  /** Short rewrite, but still a reasoning model. */
  reorganize: 900,
  /** Safety verdict needs a reasoning pass before `safe` / `unsafe`. */
  outputGuard: 500,
} as const;

/**
 * Per-stage timeouts (ms). The voice loop targets a ~2–3 s brain, so every
 * critical stage gets a hard ceiling; a timed-out stage degrades gracefully
 * instead of stalling the speaker.
 */
export const BRAIN_TIMEOUTS_MS = {
  inputGuard: 2500,
  /**
   * The meaning-based router's hard ceiling.
   *
   * It runs CONCURRENTLY with the main model and the assist, so this is the
   * most it can ever add to a turn. Measured against the live endpoint it is
   * bimodal: 0.9–2.0 s when Gemini answers, and a full stall to the ceiling when
   * it does not. 1.2 s aborted almost every call and the router silently
   * degraded to the regexes; 2.5 s still cut off valid answers and left the
   * route decided by a TIMEOUT rather than a decision, which is how a live
   * question about an unlisted topic kept being answered from memory.
   *
   * 6 s accepts the slow-but-real answer instead of guessing, and costs nothing
   * on a simple-chat turn (which skips the router) or a deterministic LIVE turn
   * (which never fires it). A turn is always max(main, assist, router) — never
   * the sum — so this cannot stack behind the responder's own 12 s budget.
   */
  router: 6000,
  respond: 12000,
  /**
   * Bright Data launches a real browser for one SERP fetch, and on a successful
   * request this regularly needs more than 6.5 s — measured landings span
   * 2.4 s to well past 10 s on a warm zone, and the browser session itself
   * competes for the same machine the voice loop is running on.
   *
   * 20 s is the ONE shared budget for a whole lookup: backoff waits and
   * per-attempt aborts are computed from it, so a gateway-reject retry can
   * never extend a turn past it. A timeout is still never retried (see
   * `serpSearchDetailed`), and two consecutive timeouts still open a
   * process-local circuit breaker for a minute so the honest line is spoken
   * immediately instead of after a silent wait.
   */
  search: 20000,
  /**
   * Step 2's hard ceiling — locked at 800 ms.
   *
   * The assist runs CONCURRENTLY with the main model, so this value is the most
   * it can ever add to a turn; a slower assist is dropped, not waited on. That is
   * what keeps Gemini off the critical path.
   */
  fastAssist: 800,
  reorganize: 8000,
  outputGuard: 4000,
  background: 10000,
} as const;
