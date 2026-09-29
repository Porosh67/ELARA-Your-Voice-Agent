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
 * - The token is single-use and expires in `ASSEMBLYAI_TOKEN_TTL_SECONDS`, so a
 *   leaked token is worthless almost immediately.
 * - No audio transits this route, and nothing about the user is logged.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cap the session so a forgotten tab cannot bill indefinitely. */
const MAX_SESSION_SECONDS = 600;

interface AssemblyAiTokenResponse {
  token?: string;
  expires_in_seconds?: number;
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  // 1. Require an authenticated user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("You must be signed in to start a voice session.", 401);
  }

  // 2. Rate limit per user — minting streams is the STT budget; keyed
  //    separately from the brain so the two limits never steal from each
  //    other. SERP calls are covered by the brain route's own limit.
  if (isRateLimited(`voice-token:${user.id}`)) {
    return jsonError(
      "You're starting sessions quickly — give it a few seconds.",
      429
    );
  }

  // 3. Fail clearly when the key is absent, rather than throwing a 500.
  if (!isAssemblyAiConfigured()) {
    return jsonError(
      "Voice is not configured on this deployment. " +
        "Add ASSEMBLYAI_API_KEY to the server environment.",
      503
    );
  }

  // 4. Exchange the API key for a temporary token.
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