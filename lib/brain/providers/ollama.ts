import "server-only";

import { getOllamaApiKey, getOllamaBaseUrl } from "@/lib/brain/env";

/**
 * Ollama Cloud chat via its OpenAI-compatible endpoint. Used only as the
 * stage-3 fallback and the background long-context summarizer.
 */

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
}

export async function ollamaChat(options: {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<string | null> {
  const apiKey = getOllamaApiKey();

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${getOllamaBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.6,
        max_tokens: options.maxOutputTokens ?? 256,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as OpenAiChatResponse;
    const text = payload.choices?.[0]?.message?.content;

    return typeof text === "string" && text.trim().length > 0
      ? text.trim()
      : null;
  } catch {
    return null;
  }
}
