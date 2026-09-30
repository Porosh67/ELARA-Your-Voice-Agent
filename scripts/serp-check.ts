/**
 * Standalone Bright Data SERP diagnostic.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/test-hooks.mjs scripts/serp-check.ts
 *
 * Prints ONLY: elapsed ms, http status, result count, outcome.
 * Never prints the token, the zone, the query text or any response body.
 * Safe to run against a live account.
 */
import { serpSearchDetailed } from "@/lib/brain/providers/brightdata";

/** A neutral, non-demo query: the point is the SHAPE of the request, not the topic. */
const QUERY = "population of Portugal";

/** Hard ceiling for this diagnostic, independent of the provider's own budget. */
const BUDGET_MS = 20_000;

const startedAt = Date.now();

try {
  const outcome = await serpSearchDetailed(QUERY, BUDGET_MS, {
    lookupKind: "search",
    maxAttempts: 1,
  });

  const elapsed = Date.now() - startedAt;
  const count =
    outcome.kind === "ok" && typeof outcome.results === "string"
      ? outcome.results.split("\n").filter((line) => line.trim().length > 0).length
      : 0;
  const http =
    outcome.kind === "error" ? String(outcome.status) : outcome.kind === "ok" ? "200" : "n/a";

  console.log(
    JSON.stringify({ elapsedMs: elapsed, http, results: count, outcome: outcome.kind })
  );

  if (outcome.kind === "ok" && count > 0 && elapsed < 6000) {
    console.log("VERDICT: ok");
  } else {
    console.log("VERDICT: not-ok");
  }
} catch (error) {
  const elapsed = Date.now() - startedAt;
  const name = error instanceof Error ? error.name : "Error";
  console.log(JSON.stringify({ elapsedMs: elapsed, http: "0", results: 0, outcome: name }));
  console.log("VERDICT: not-ok");
}
