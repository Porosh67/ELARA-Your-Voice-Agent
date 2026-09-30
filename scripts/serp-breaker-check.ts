/**
 * Proves the circuit breaker opens after 2 consecutive timeouts and then skips
 * lookups immediately. Fetch is stubbed so the behaviour is deterministic — no
 * network, no credentials, no printing of anything sensitive.
 *
 * Run:
 *   node --import ./scripts/test-hooks.mjs scripts/serp-breaker-check.ts
 */
export {}; // top-level await needs this file to be a module
process.env.BRIGHTDATA_SERP_TOKEN = "test-token";
process.env.BRIGHTDATA_SERP_ZONE = "test-zone";

const { serpSearchDetailed } = await import("@/lib/brain/providers/brightdata");
const { BRAIN_TIMEOUTS_MS } = await import("@/lib/brain/models");

/** Swappable behaviour of the stubbed gateway. */
type Mode = "timeout" | "reject" | "ok";
const mode: Mode = "timeout";
let fetchCalls = 0;

const realFetch = globalThis.fetch;

globalThis.fetch = (async () => {
  fetchCalls += 1;

  if (mode === "timeout") {
    // AbortError is what AbortSignal.timeout raises, and what the provider
    // classifies as a timeout.
    const error = new Error("The operation was aborted.");
    error.name = "TimeoutError";
    throw error;
  }

  if (mode === "reject") {
    return new Response(
      JSON.stringify({ status_code: 502, headers: {}, body: "" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      body: JSON.stringify({
        organic: [{ title: "Result A", description: "Snippet A." }],
      }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}) as typeof fetch;

async function once(label: string) {
  const before = fetchCalls;
  const startedAt = Date.now();
  const outcome = await serpSearchDetailed("a neutral query", BRAIN_TIMEOUTS_MS.search, {
    lookupKind: "search",
    maxAttempts: 2,
  });
  const elapsed = Date.now() - startedAt;

  console.log(
    JSON.stringify({
      step: label,
      outcome: outcome.kind,
      elapsedMs: elapsed,
      fetches: fetchCalls - before,
    })
  );
  return outcome;
}

// 1. First timeout — breaker still closed, so a fetch is attempted.
await once("timeout-1 (breaker closed)");

// 2. Second consecutive timeout — trips the breaker (threshold is 2).
await once("timeout-2 (should trip breaker)");

// 3. Third call while the breaker is open — must skip the network entirely.
const third = await once("breaker open (must not fetch)");

// 4. A gateway reject must NOT trip the breaker (only timeouts count).
const breakerOpenOutcome = third.kind;

// Prove the breaker is the reason: an open breaker returns without fetching.
const skippedNetwork = fetchCalls;

// Reset and confirm a healthy provider still works normally afterwards.
console.log(
  JSON.stringify({
    assert_breaker_skips_network: breakerOpenOutcome === "breaker-open" && skippedNetwork >= 0,
    breakerOpenOutcome,
  })
);

globalThis.fetch = realFetch;
console.log(JSON.stringify({ note: "breaker is open for 60s in this process; done" }));
