import "server-only";

import { getGoogleAiApiKey } from "@/lib/brain/env";

/**
 * Google AI Studio client — Gemini generateContent and embeddings. All failures
 * resolve to `null` / `[]`; the pipeline skips Google steps it can't run.
 */

const GOOGLE_AI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiContent {
  role: "user" | "model";
  text: string;
}

interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export async function googleGenerate(options: {
  model: string;
  system?: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<string | null> {
  const apiKey = getGoogleAiApiKey();

  if (!apiKey) {
    return null;
  }

  const body: Record<string, unknown> = {
    contents: options.contents.map((content) => ({
      role: content.role,
      parts: [{ text: content.text }],
    })),
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 256,
    },
  };

  if (options.system) {
    body.systemInstruction = { parts: [{ text: options.system }] };
  }

  try {
    const response = await fetch(
      `${GOOGLE_AI_BASE}/models/${options.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs),
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as GeminiGenerateResponse;
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

interface GeminiEmbedResponse {
  embedding?: { values?: number[] };
}

export async function googleEmbed(options: {
  model: string;
  text: string;
  timeoutMs: number;
}): Promise<number[] | null> {
  const apiKey = getGoogleAiApiKey();

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      `${GOOGLE_AI_BASE}/models/${options.model}:embedContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({ content: { parts: [{ text: options.text }] } }),
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs),
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as GeminiEmbedResponse;
    const values = payload.embedding?.values;

    return Array.isArray(values) && values.length > 0 ? values : null;
  } catch {
    return null;
  }
}
