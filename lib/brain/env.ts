import "server-only";

/**
 * Server-side access to the Main Brain credentials. Keys are read on demand and
 * are NEVER logged, echoed, or returned — the availability flags are the only
 * thing the rest of the pipeline may branch on.
 */

function readKey(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function getGroqApiKey(): string {
  return readKey("GROQ_API_KEY");
}

export function getGoogleAiApiKey(): string {
  return readKey("GOOGLE_AI_API_KEY");
}

export function getBrightDataSerpToken(): string {
  return readKey("BRIGHTDATA_SERP_TOKEN");
}

export function getBrightDataSerpZone(): string {
  return readKey("BRIGHTDATA_SERP_ZONE");
}

export function getOllamaApiKey(): string {
  return readKey("OLLAMA_API_KEY");
}

/** Ollama Cloud's OpenAI-compatible base. Overridable for self-hosting. */
export function getOllamaBaseUrl(): string {
  return readKey("OLLAMA_BASE_URL") || "https://ollama.com";
}

export const isGroqConfigured = (): boolean => getGroqApiKey().length > 0;
export const isGoogleAiConfigured = (): boolean =>
  getGoogleAiApiKey().length > 0;
export const isBrightDataConfigured = (): boolean =>
  getBrightDataSerpToken().length > 0 && getBrightDataSerpZone().length > 0;
export const isOllamaConfigured = (): boolean => getOllamaApiKey().length > 0;
