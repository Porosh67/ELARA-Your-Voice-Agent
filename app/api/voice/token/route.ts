import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ASSEMBLYAI_STREAMING_API_BASE,
  ASSEMBLYAI_TOKEN_TTL_SECONDS,
  getAssemblyAiApiKey,
  isAssemblyAiConfigured,
} from "@/lib/voice/env";
import { isRateLimited } from "@/lib/brain/rate-limit";

/**
 * Mints a short-lived, single-use AssemblyAI streaming token.
 *
 * Why this route exists: the browser cannot hold `ASSEMBLYAI_API_KEY`, and the
 * WebSocket API cannot send custom headers. So the server exchanges the API key
 * for an ephemeral token and the client passes that token as a query parameter.
 * The API key never leaves the server.
 *
 * SECURITY
 * - `/api` is excluded from the `proxy.ts` matcher, so this handler performs its
 *   OWN Supabase session check. Without it, anyone could farm tokens.
 * - Cross-site requests are refused. `SameSite=Lax` cookies ARE sent on a
 *   cross-site top-level GET (an `<img>`, `<link>`, or a followed link), so
 *   without this any page a signed-in user visits could silently trigger a
 *   token mint. The header check stops that without changing the client.
 * - The token is single-use and expires in `ASSEMBLYAI_TOKEN_TTL_SECONDS`, so a
 *   leaked token is worthless almost immediately.
 * - No audio transits this route, and nothing about the user is logged.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cap the session so a forgotten tab cannot bill indefinitely. */
const MAX_SESSION_SECONDS = 600;

/** Window used for the `Retry-After` hint on 429, matching the limiter. */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

interface AssemblyAiTokenResponse {
  token?: string;
  expires_in_seconds?: number;
}

function jsonError(message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store", ...(headers ?? {}) },
    }
  );
}

/**
 * True when the request came from another origin.
 *
 * `Sec-Fetch-Site` is a forbidden-header set value browsers attach to every
 * fetch/navigation and scripts cannot forge. When it is absent (an old client,
 * curl, or a server-side call) we allow the request — this is a hardening layer
 * on top of the session check, not a replacement for it.
 */
function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");

  if (site === null) {
    return false;
  }

  return site === "cross-site";
}

export async function GET(request: Request) {
  // 1. Refuse cross-site callers BEFORE spending a token mint.
  if (isCrossSiteRequest(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }

  // 2. Require an authenticated user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("You must be signed in to start a voice session.", 401);
  }

  // 3. Rate limit per user — minting streams is the STT budget; keyed
  //    separately from the brain so the two limits never steal from each
  //    other. SERP calls are covered by the brain route's own limit.
  if (isRateLimited(`voice-token:${user.id}`)) {
    return jsonError(
      "You're starting sessions quickly — give it a few seconds.",
      429,
      { "Retry-After": String(RATE_LIMIT_RETRY_AFTER_SECONDS) }
    );
  }

  // 4. Fail clearly when the key is absent, rather than throwing a 500.
  if (!isAssemblyAiConfigured()) {
    return jsonError(
      "Voice is not configured on this deployment. " +
        "Add ASSEMBLYAI_API_KEY to the server environment.",
      503
    );
  }

  // 5. Exchange the API key for a temporary token.
  const url = new URL(`${ASSEMBLYAI_STREAMING_API_BASE}/token`);
  url.searchParams.set("expires_in_seconds", String(ASSEMBLYAI_TOKEN_TTL_SECONDS));
  url.searchParams.set("max_session_duration_seconds", String(MAX_SESSION_SECONDS));

  let upstream: Response;

  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: { Authorization: getAssemblyAiApiKey() },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return jsonError(
      "Could not reach the voice service. Please try again.",
      504
    );
  }

  if (!upstream.ok) {
    // Deliberately generic: never echo upstream bodies (they can include key
    // hints) or any credential material back to the client.
    return jsonError(
      upstream.status === 401
        ? "The voice service rejected our credentials."
        : "The voice service is unavailable right now.",
      upstream.status === 401 ? 502 : 502
    );
  }

  let payload: AssemblyAiTokenResponse;

  try {
    payload = (await upstream.json()) as AssemblyAiTokenResponse;
  } catch {
    return jsonError("The voice service returned an unreadable response.", 502);
  }

  if (!payload.token) {
    return jsonError("The voice service did not return a token.", 502);
  }

  return NextResponse.json(
    {
      token: payload.token,
      expiresInSeconds: payload.expires_in_seconds ?? ASSEMBLYAI_TOKEN_TTL_SECONDS,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}