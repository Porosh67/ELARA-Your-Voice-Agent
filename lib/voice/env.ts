import "server-only";

/**
 * Centralized, validated access to AssemblyAI environment variables.
 *
 * SECURITY: `ASSEMBLYAI_API_KEY` is SERVER-ONLY. It must never be imported into
 * client code and must never be prefixed with `NEXT_PUBLIC_`.
 *
 * The browser never sees this key. Instead, `app/api/voice/token/route.ts`
 * mints a short-lived (60s) streaming token server-side and hands only that to
 * the client, which is the documented AssemblyAI browser flow.
 */

/**
 * Returns the AssemblyAI API key.
 *
 * Throws if called in a browser context (defence-in-depth; `server-only`
 * already makes this a build error) or if the variable is missing.
 */
export function getAssemblyAiApiKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("ASSEMBLYAI_API_KEY must never be accessed in the browser.");
  }

  const key = process.env.ASSEMBLYAI_API_KEY;

  if (!key || key.trim().length === 0) {
    throw new Error(
      "Missing required environment variable: ASSEMBLYAI_API_KEY. " +
        "Add it to .env.local (see .env.local.example)."
    );
  }

  return key.trim();
}

/**
 * Whether AssemblyAI is configured.
 *
 * Used to return a friendly 503 from the token route instead of throwing, so
 * the voice UI can explain what is missing rather than showing a crash.
 */
export function isAssemblyAiConfigured(): boolean {
  const key = process.env.ASSEMBLYAI_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/** AssemblyAI streaming REST base URL (token minting). */
export const ASSEMBLYAI_STREAMING_API_BASE = "https://streaming.assemblyai.com/v3";

/**
 * Lifetime of the minted token, in seconds.
 *
 * This is the *redemption window* only — the client must open the WebSocket
 * within this period. It does NOT cap the streaming session length, so a short
 * window is the safest choice: a leaked token is useless almost immediately.
 */
export const ASSEMBLYAI_TOKEN_TTL_SECONDS = 60;