import "server-only";

import { getGroqApiKey } from "@/lib/brain/env";

/**
 * Minimal OpenAI-compatible chat client for Groq.
 *
 * Every failure mode — missing key, non-2xx, timeout, malformed body — resolves
 * to `null` so callers can degrade gracefully instead of crashing the voice loop.
 *
 * ── REASONING MODELS ─────────────────────────────────────────────────────────
 *
 * Groq's gpt-oss / qwen / safeguard models run a hidden reasoning pass whose
 * tokens are charged against `max_completion_tokens`. When the budget runs out
 * mid-reasoning the API returns an EMPTY `content` with
 * `finish_reason: "length"` — a silently useless reply. `finishReason` is
 * therefore inspected, and an empty body with `"length"` is retried once with a
 * much larger ceiling rather than being reported as a failure.
 */

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Ceiling for the automatic retry after a reasoning-starved response. */
const RETRY_TOKEN_FLOOR = 4096;

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GroqChatResponse {
  choices?: {
    message?: { content?: string };
    finish_reason?: string;
  }[];
}

interface GroqCompletion {
  text: string | null;
  finishReason: string | null;
}

/**
 * One HTTP round trip. Never throws; surfaces the finish reason so the caller can
 * tell "model had nothing to say" apart from "model ran out of budget".
 */
async function groqRequest(options: {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  /**
   * Reduce the hidden reasoning pass. Only sent to models known to accept it;
   * if the API rejects the field the request is retried without it, so an
   * unsupported parameter can never break a stage.
   */
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<GroqCompletion> {
  const apiKey = getGroqApiKey();

  if (!apiKey) {
    return { text: null, finishReason: null };
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_completion_tokens: options.maxOutputTokens ?? 512,
    stream: false,
  };

  if (options.reasoningEffort) {
    body.reasoning_effort = options.reasoningEffort;
  }

  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
      // A model that doesn't know `reasoning_effort` returns 400. Retry once
      // without it rather than failing the stage.
      if (options.reasoningEffort) {
        return groqRequest({ ...options, reasoningEffort: undefined });
      }

      return { text: null, finishReason: null };
    }

    const payload = (await response.json()) as GroqChatResponse;
    const choice = payload.choices?.[0];
    const text = choice?.message?.content;

    return {
      text: typeof text === "string" && text.trim().length > 0 ? text.trim() : null,
      finishReason: choice?.finish_reason ?? null,
    };
  } catch {
    return { text: null, finishReason: null };
  }
}

export async function groqChat(options: {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<string | null> {
  const first = await groqRequest(options);

  if (first.text) {
    return first.text;
  }

  /*
   * Empty + `length` means the reasoning pass consumed the entire allowance
   * before emitting any visible text. That is a budget problem, not a model
   * failure, so retry once with real headroom.
   */
  if (first.finishReason === "length") {
    const retry = await groqRequest({
      ...options,
      maxOutputTokens: Math.max(
        RETRY_TOKEN_FLOOR,
        (options.maxOutputTokens ?? 512) * 2
      ),
    });

    return retry.text;
  }

  return null;
}
