/**
 * Measures how often a single SERP attempt succeeds, using the app's own shape.
 * Reports only timings/status/counts/outcomes — never token, zone or query.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/test-hooks.mjs scripts/serp-reliability.ts
 */
import { serpSearchDetailed } from "@/lib/brain/providers/brightdata";
import { BRAIN_TIMEOUTS_MS } from "@/lib/brain/models";

const QUERY = "population of Portugal";
const ATTEMPTS = 4;
/** The real production budget, so this measures what a LIVE turn actually pays. */
const PER_ATTEMPT_BUDGET_MS = BRAIN_TIMEOUTS_MS.search;

let ok = 0;
let failed = 0;
const times: number[] = [];

for (let i = 0; i < ATTEMPTS; i += 1) {
  const startedAt = Date.now();

  let http = "0";
  let results = 0;
  let outcome = "error";

  try {
    const r = await serpSearchDetailed(QUERY, PER_ATTEMPT_BUDGET_MS, {
      lookupKind: "search",
      maxAttempts: 1,
    });
    const elapsed = Date.now() - startedAt;
    times.push(elapsed);
    http = r.kind === "error" ? String(r.status) : r.kind === "ok" ? "200" : "n/a";
    results =
      r.kind === "ok" && typeof r.results === "string"
        ? r.results.split("\n").filter((l) => l.trim().length > 0).length
        : 0;
    outcome = r.kind;

    if (r.kind === "ok" && results > 0) {
      ok += 1;
    } else {
      failed += 1;
    }
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    times.push(elapsed);
    outcome = error instanceof Error ? error.name : "Error";
    failed += 1;
  }

  console.log(
    JSON.stringify({ attempt: i + 1, elapsedMs: Date.now() - startedAt, http, results, outcome })
  );
}

const sorted = [...times].sort((a, b) => a - b);
console.log(
  JSON.stringify({
    summary: {
      ok,
      failed,
      total: ATTEMPTS,
      medianMs: sorted[Math.floor(sorted.length / 2)],
    },
  })
);
