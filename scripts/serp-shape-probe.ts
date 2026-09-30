/**
 * Compares the app's current request shape against the known-good shape, under
 * the PRODUCTION timeout, and reports only timings/status/counts/outcomes.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/test-hooks.mjs scripts/serp-shape-probe.ts
 *
 * Never prints token, zone, query text or response bodies.
 */
export {}; // top-level await needs this file to be a module
const ZONE = process.env.BRIGHTDATA_SERP_ZONE ?? "";
const TOKEN = process.env.BRIGHTDATA_SERP_TOKEN ?? "";
const ENDPOINT = "https://api.brightdata.com/request";

/** Production search budget from lib/brain/models.ts. */
const PRODUCTION_TIMEOUT_MS = 13_000;

interface Probe {
  label: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function buildProbes(): Probe[] {
  const q = encodeURIComponent("population of Portugal");
  const base = "https://www.google.com/search?q=" + q;

  return [
    {
      label: "app-current: format=json + x-unblock-data-format=parsed_light",
      url: base,
      headers: { "Content-Type": "application/json", "x-unblock-data-format": "parsed_light" },
      body: { zone: ZONE, url: base, format: "json" },
    },
    {
      label: "known-good: format=raw + brd_json=1 in URL",
      url: base + "&brd_json=1",
      headers: { "Content-Type": "application/json" },
      body: { zone: ZONE, url: base + "&brd_json=1", format: "raw" },
    },
    {
      label: "variant: format=json, no parsed_light header",
      url: base,
      headers: { "Content-Type": "application/json" },
      body: { zone: ZONE, url: base, format: "json" },
    },
  ];
}

function countOrganic(payload: unknown): number {
  const record = payload as { organic?: unknown; body?: unknown } | null;
  if (record && Array.isArray(record.organic)) {
    return record.organic.length;
  }
  // raw shape: the whole SERP arrives as a JSON string under `body`
  if (record && typeof record.body === "string") {
    try {
      const inner = JSON.parse(record.body) as { organic?: unknown };
      if (Array.isArray(inner.organic)) {
        return inner.organic.length;
      }
    } catch {
      return -1; // not JSON
    }
  }
  return 0;
}

for (const probe of buildProbes()) {
  const startedAt = Date.now();
  let http = 0;
  let results = 0;
  let outcome = "error";

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        ...probe.headers,
        Authorization: "Bearer " + TOKEN,
      },
      body: JSON.stringify(probe.body),
      cache: "no-store",
      signal: AbortSignal.timeout(PRODUCTION_TIMEOUT_MS),
    });

    http = response.status;
    outcome = response.ok ? "ok" : "http-error";

    if (response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      results = countOrganic(payload);
      if (results === -1) {
        outcome = "non-json";
        results = 0;
      }
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    outcome = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
  }

  const elapsed = Date.now() - startedAt;
  console.log(
    JSON.stringify({ probe: probe.label, elapsedMs: elapsed, http, results, outcome })
  );
}
