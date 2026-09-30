import "server-only";

import { getBrightDataSerpToken, getBrightDataSerpZone } from "@/lib/brain/env";

/**
 * Bright Data SERP search. Returns formatted result snippets, or `null` when
 * the integration isn't configured or fails — the caller then chooses: LIVE
 * turns speak ONE honest canned line (memory is banned for current facts),
 * while the model's `[SEARCH: …]` marker path falls back the same way. No
 * failure ever turns into a fabricated current fact, and the voice loop never
 * dies on a lookup.
 */

const BRIGHT_DATA_REQUEST_URL = "https://api.brightdata.com/request";
const MAX_RESULTS = 5;

/** Outcome of a SERP attempt - enough for the caller to pick an honest line. */
export type SerpResult =
  | { kind: "ok"; results: string }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "error"; status: number };

/**
 * One structured server-side line per lookup (this module is `server-only`).
 *
 * Carries ONLY booleans, an outcome / error class, HTTP status and timing —
 * never the token, the zone value, the query text or a response body — so a
 * failed lookup is diagnosable from the server log without leaking anything.
 */
function logSearch(entry: Record<string, unknown>): void {
  console.log("[serp]", JSON.stringify(entry));
}

/**
 * Inner gateway status of the sync endpoint's `{ status_code, headers, body }`
 * wrapper, or `null` when the payload is not that wrapper (another zone
 * configuration can answer with the SERP directly).
 */
function gatewayStatus(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const record = payload as { status_code?: unknown };
  return typeof record.status_code === "number" ? record.status_code : null;
}

/** True when the wrapper is present but its `body` carries nothing at all. */
function wrappedBodyEmpty(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return false;
  }

  const record = payload as { body?: unknown };
  return typeof record.body === "string" && record.body.length === 0;
}

/**
 * Options for one lookup attempt cycle. Nothing here changes the REQUEST
 * (payload, zone, format and Light header are untouched) — only how the
 * caller's deadline is spent and what the log line carries.
 */
export interface SerpLookupOptions {
  /**
   * Which honest line a failure earns upstream ("time" | "weather" |
   * "search"). Echoed into every `[serp]` log line as `kind` — a word, never
   * the query itself.
   */
  lookupKind?: "time" | "weather" | "search";
  /**
   * Attempt cap inside the shared deadline. Default 3 (the provider's
   * reject-retry behaviour); deterministic LIVE passes 2 so a flaky gateway
   * cannot burn the whole window before the honest line.
   */
  maxAttempts?: number;
}

/**
 * Runs one SERP query and reports WHY it ended the way it did.
 *
 * The reason reaches the person: "unavailable" (no credentials) and "empty"
 * (the provider answered with nothing usable) both mean Elara falls back to
 * what she knows, while "error" means the provider is reachable but unhappy.
 * Each case gets its own short honest sentence - never the generic dead-end.
 *
 * LIVE FIX (verified against the API reference for `POST
 * https://api.brightdata.com/request`): the documented body is exactly
 * `{ zone, url, format }`, where `zone` is the zone NAME — `"serp_api1"` in
 * the docs, `serp_api2` here — and `format` is the enum `raw` | `json`.
 * The earlier payload sent `format: "raw"` plus an undocumented `brd_json`
 * field (that field belongs to the ASYNC `/serp/req` endpoint, not
 * `/request`), so the gateway could reject the request outright — which is
 * why the Bright Data dashboard showed ZERO activity while every live turn
 * spoke the honest fallback. `format: "json"` is the documented parsed
 * form: the response carries the `organic` array `extractOrganicResults`
 * expects, on the synchronous endpoint that a voice turn needs.
 */
export async function serpSearchDetailed(
  query: string,
  timeoutMs: number,
  options: SerpLookupOptions = {}
): Promise<SerpResult> {
  const token = getBrightDataSerpToken();
  const zone = getBrightDataSerpZone();

  /*
   * Every log line below goes through this wrapper so `kind` (the honest-line
   * class the caller expects) is stamped once, centrally. The entry itself is
   * still built by the caller — and, as before, may carry ONLY statuses,
   * timing, counts, shape and outcome: never the token, the zone value, the
   * query text or a response body.
   */
  const log = (entry: Record<string, unknown>): void =>
    logSearch({ kind: options.lookupKind, ...entry });
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  if (!token || !zone || query.trim().length === 0) {
    log({
      configured: { token: token.length > 0, zone: zone.length > 0 },
      attempted: false,
      reason: query.trim().length === 0 ? "empty-query" : "not-configured",
    });
    return { kind: "unavailable" };
  }

  // No `num` parameter: the zone flags it as unacceptable and strips it
  // (`x-brd-serp-warn`), and the MAX_RESULTS slice below caps the list anyway.
  const searchUrl =
    "https://www.google.com/search?q=" + encodeURIComponent(query.trim());

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  /*
   * TRANSIENT GATEWAY REJECTS ARE RETRIED INSIDE THE CALLER'S DEADLINE.
   *
   * The sync endpoint answers HTTP 200 even when the fetch failed: the body
   * wraps `{ status_code, headers, body }` with a NON-200 `status_code`
   * ("captcha", "expect_body" — seen live at roughly one attempt in two) and
   * an empty `body`. Checking only `response.ok` read that as "no results",
   * which is how ONE transient reject became the canned fallback — the
   * intermittently dead live turns (time, news and weather alike). A reject is
   * retried until the shared deadline; a genuine 200 that carries results (or
   * a real empty set) still returns immediately. The log carries only
   * statuses, outcome, attempt count and timing — never query or body.
   */
const backoffMs = [300, 700, 1500];
   let lastHttp = 0;
   let lastBrd: number | null = null;
   /** Class of the most recent failure — the final log reports it as `outcome`
    *  so the vocabulary stays ok | empty | gateway-reject | timeout | error. */
   let lastFault: "timeout" | "error" = "error";

   for (let attempt = 0; ; attempt += 1) {
     // Attempt cap: maxAttempts (LIVE passes 3) rejects are the answer.
     if (attempt >= maxAttempts) {
      break;
    }

    if (attempt > 0) {
      const remainingBeforeWait = deadline - Date.now();

      if (remainingBeforeWait < 900) {
        break;
      }

      await new Promise<void>((resolve) =>
        setTimeout(
          resolve,
          Math.min(
            backoffMs[Math.min(attempt - 1, backoffMs.length - 1)],
            remainingBeforeWait - 600
          )
        )
      );
    }

    try {
      const response = await fetch(BRIGHT_DATA_REQUEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          // LIGHT results, asked for on EVERY attempt: `parsed_light` is the
          // documented value of the `x-unblock-data-format` override (organic
          // results + top stories only — roughly twice as fast as Full JSON).
          // The zone already defaults to Light JSON; the header makes the
          // request explicit so a dashboard-side default change can never put
          // a Full-JSON fetch on the voice path. The body shape above is
          // unchanged — this is a header-level override only.
          "x-unblock-data-format": "parsed_light",
        },
        body: JSON.stringify({
          zone,
          url: searchUrl,
          format: "json",
        }),
        cache: "no-store",
        // Each attempt runs against the SHARED deadline (a live fetch takes
        // ~4-6 s, so a per-attempt cap below that would time out real
        // answers). The retry exists for the fast failures: a gateway reject
        // comes back in well under a second and still leaves budget behind.
        signal: AbortSignal.timeout(Math.max(600, deadline - Date.now())),
      });

      const ms = Date.now() - startedAt;

      if (!response.ok) {
        // Status only — never the body, which could echo the query URL.
        log({
          attempted: true,
          http: response.status,
          ms,
          attempt,
          outcome: "http-error",
        });
        lastHttp = response.status;
        lastFault = "error";
        continue;
      }

      // The zone answers as JSON; a text body is handled defensively below.
      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        payload = await response.text().catch(() => "");
      }

      // HTTP 200 does NOT mean the SERP was fetched — the wrapper says so.
      const brdStatus = gatewayStatus(payload);

      if (brdStatus !== null && brdStatus !== 200) {
        log({
          attempted: true,
          http: 200,
          brd: brdStatus,
          ms,
          attempt,
          outcome: "gateway-reject",
        });
        lastBrd = brdStatus;
        lastFault = "error";
        continue;
      }

      const parsed = extractOrganicResults(payload);
      const organic = parsed.lines;
      // Parser diagnostics: WHICH accepted shape the payload had, and whether
      // it yielded anything — enough to tell "zone answered in an unexpected
      // shape" apart from "the SERP really was empty", with no body logged.
      const shape = parsed.shape;
      const parser = organic.length > 0 ? "ok" : "none";

      if (organic.length === 0) {
        // A 200 wrapper around a blank body is a failed fetch, not an empty
        // result set — retry it like the reject above.
        if (wrappedBodyEmpty(payload)) {
          log({
            attempted: true,
            http: 200,
            ms,
            attempt,
            shape,
            parser,
            outcome: "empty-body",
          });
          lastFault = "error";
          continue;
        }

        log({
          attempted: true,
          http: 200,
          ms,
          attempt,
          shape,
          parser,
          outcome: "empty",
        });
        return { kind: "empty" };
      }

      log({
        attempted: true,
        http: 200,
        ms,
        attempt,
        shape,
        parser,
        outcome: "ok",
        results: organic.length,
      });
      return {
        kind: "ok",
        results: organic
          .slice(0, MAX_RESULTS)
          .map((result, index) => index + 1 + ". " + result)
          .join("\n"),
      };
    } catch (error) {
      // Error CLASS only — `message` can embed the request URL and its query.
      const ms = Date.now() - startedAt;
      const name = error instanceof Error ? error.name : "Error";
      const errorClass =
        name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
      lastFault = errorClass === "timeout" ? "timeout" : "error";
      log({ attempted: true, ms, attempt, outcome: lastFault, errorClass });
    }
  }

  // Deadline exhausted on rejects/errors — honest "provider unhappy" outcome,
  // reported as `timeout` when the budget was burned by aborted fetches.
  log({
    attempted: true,
    ms: Date.now() - startedAt,
    http: lastHttp,
    brd: lastBrd ?? undefined,
    outcome: lastFault,
  });
  return { kind: "error", status: lastBrd ?? lastHttp };
}

/**
 * Thin wrapper for callers that only need the text: formatted snippets, or
 * `null` when the lookup produced nothing usable.
 */
export async function serpSearch(
  query: string,
  timeoutMs: number
): Promise<string | null> {
  const outcome = await serpSearchDetailed(query, timeoutMs);
  return outcome.kind === "ok" ? outcome.results : null;
}

/** Parse JSON defensively; anything unparseable is simply not JSON. */
function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** What the parser found, and the SHAPE it was found in (diagnostics only). */
export interface OrganicExtraction {
  /** Title + snippet lines the synthesizer will be grounded on. */
  lines: string[];
  /**
   * Which accepted payload shape produced `lines` — "array", "object-organic",
   * "object-results", "object-wrapped:…", "object-answer", "body-json:…",
   * "body-html", or a miss shape ("unparseable-string", "non-object",
   * "object-empty"). Logged as `shape` so an unexpected zone configuration is
   * visible from the server log WITHOUT ever logging the body itself.
   */
  shape: string;
}

/**
 * Bright Data's SERP shape varies by zone configuration. Three base shapes
 * (plus two conservative extensions) are accepted, so a configuration
 * difference degrades into "no results" at worst - never into a crash on the
 * critical path:
 *   1. an array of result objects,
 *   2. an object carrying an `organic` (or `results`) array — plain, or
 *      object-wrapped one level down (`{ organic: { organic: [...] } }`),
 *   3. an object whose `body` holds the page as JSON text or as raw HTML.
 * Extensions (conservative — keys seen in parsed-light answers):
 *   4. a featured-answer block (`general` / `answer` / `light_answer`) when no
 *      organic list exists,
 *   5. a bare `url` / `link` when a result object has neither title nor
 *      snippet.
 *
 * Exported so the regression battery can verify the parser directly against
 * representative payloads — the request shape itself is validated in tests,
 * never changed here.
 */
export function extractOrganicResults(payload: unknown): OrganicExtraction {
  const decoded = typeof payload === "string" ? parseJsonOrNull(payload) : payload;

  if (decoded === null) {
    return {
      lines: [],
      shape: typeof payload === "string" ? "unparseable-string" : "unparseable",
    };
  }

  if (Array.isArray(decoded)) {
    return { lines: collectFromArray(decoded), shape: "array" };
  }

  if (typeof decoded !== "object") {
    return { lines: [], shape: "non-object" };
  }

  const record = decoded as {
    organic?: unknown;
    results?: unknown;
    general?: unknown;
    answer?: unknown;
    light_answer?: unknown;
    body?: unknown;
  };

  const results: string[] = [];
  let shape: string | null = null;

  for (const [key, candidate] of [
    ["organic", record.organic],
    ["results", record.results],
  ] as const) {
    if (Array.isArray(candidate)) {
      results.push(...collectFromArray(candidate));
      shape ??= `object-${key}`;
    } else if (typeof candidate === "object" && candidate !== null) {
      // Object-wrapped list one level down — recurse, keep it bounded by the
      // payload's own structure (JSON cannot self-reference).
      const wrapped = extractOrganicResults(candidate);

      if (wrapped.lines.length > 0) {
        results.push(...wrapped.lines);
        shape ??= `object-wrapped:${wrapped.shape}`;
      }
    }
  }

  // A featured-answer block, used only when no organic list carried anything.
  if (results.length === 0) {
    for (const answer of [record.general, record.answer, record.light_answer]) {
      const line = answerLine(answer);

      if (line.length > 0) {
        results.push(line);
        shape = "object-answer";
        break;
      }
    }
  }

  if (results.length === 0 && typeof record.body === "string") {
    const inner = parseJsonOrNull(record.body);

    if (inner !== null) {
      const wrapped = extractOrganicResults(inner);
      return { lines: wrapped.lines, shape: `body-json:${wrapped.shape}` };
    }

    return { lines: collectLooseText(record.body), shape: "body-html" };
  }

  return { lines: results, shape: shape ?? "object-empty" };
}

/** Title/snippet text from a featured-answer block, or `""`. */
function answerLine(answer: unknown): string {
  if (typeof answer === "string") {
    return answer.trim().slice(0, 300);
  }

  if (typeof answer !== "object" || answer === null) {
    return "";
  }

  const record = answer as {
    title?: unknown;
    description?: unknown;
    snippet?: unknown;
    text?: unknown;
  };
  const title = typeof record.title === "string" ? record.title : "";
  const snippet =
    typeof record.description === "string"
      ? record.description
      : typeof record.snippet === "string"
        ? record.snippet
        : typeof record.text === "string"
          ? record.text
          : "";

  return [title, snippet].filter(Boolean).join(" - ").trim().slice(0, 300);
}

/** Title + snippet lines from an array of SERP result objects. */
function collectFromArray(entries: unknown[]): string[] {
  const results: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const record = entry as {
      title?: unknown;
      description?: unknown;
      snippet?: unknown;
      url?: unknown;
      link?: unknown;
    };

    const title = typeof record.title === "string" ? record.title : "";
    const snippet =
      typeof record.description === "string"
        ? record.description
        : typeof record.snippet === "string"
          ? record.snippet
          : "";

    const line = [title, snippet].filter(Boolean).join(" - ").trim();

    if (line.length > 0) {
      results.push(line.slice(0, 300));
      continue;
    }

    // Last resort: some zone shapes answer with only a link. A bare URL is a
    // poor snippet but a real, verifiable fact — better than dropping the
    // result entirely.
    const url =
      typeof record.url === "string"
        ? record.url
        : typeof record.link === "string"
          ? record.link
          : "";

    if (url.length > 0) {
      results.push(url.slice(0, 300));
    }
  }

  return results;
}

/**
 * Last resort for a raw-HTML answer: strip the markup and take three
 * evenly-spaced windows of readable text. Crude on purpose - it exists so a
 * misconfigured zone still yields something the model can use, instead of a
 * silent empty result.
 */
function collectLooseText(html: string): string[] {
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (plain.length === 0) {
    return [];
  }

  const windowSize = Math.min(300, Math.max(120, Math.floor(plain.length / 3)));
  const chunks: string[] = [];

  for (let index = 0; index < 3; index += 1) {
    const start = Math.max(0, Math.floor((plain.length - windowSize) * (index / 3)));
    const chunk = plain.slice(start, start + windowSize).trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}
