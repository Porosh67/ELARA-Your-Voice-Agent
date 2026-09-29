import "server-only";

import {
  BRAIN_TIMEOUTS_MS,
  GOOGLE_MODELS,
  OLLAMA_MODELS,
} from "@/lib/brain/models";
import { isGoogleAiConfigured, isOllamaConfigured } from "@/lib/brain/env";
import { googleEmbed, googleGenerate } from "@/lib/brain/providers/google";
import { ollamaChat } from "@/lib/brain/providers/ollama";
import type { BrainTurn } from "@/lib/brain/types";

/**
 * BACKGROUND PATH — runs after the response is already on its way to the
 * speaker (scheduled via `after()` in the route). It NEVER delays the voice
 * loop, and every step silently skips when its key is missing.
 *
 * Storage is process-local memory only. Nothing here persists to disk or a
 * database, and NOTHING is logged — consistent with the no-audio/no-transcript
 * privacy rules until real memory storage lands in a later phase.
 */

const MAX_EMBEDDINGS_PER_USER = 50;
const MAX_LONG_CONTEXT_TURNS = 12;

interface MemoryEntry {
  vector: number[];
  at: number;
}

/** userId → recent embeddings (newest last). */
const embeddings = new Map<string, MemoryEntry[]>();
/** userId → last quality verdict (1-10). */
const qualityScores = new Map<string, number>();
/** userId → rolling long-context summary. */
const summaries = new Map<string, string>();

/** Bounded push: keep the newest entries, drop the oldest. */
function pushBounded<T>(list: T[], entry: T, cap: number): T[] {
  const next = [...list, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

async function embedRemember(userId: string, userText: string): Promise<void> {
  const vector = await googleEmbed({
    model: GOOGLE_MODELS.embedding,
    text: userText,
    timeoutMs: BRAIN_TIMEOUTS_MS.background,
  });

  if (vector) {
    embeddings.set(
      userId,
      pushBounded(embeddings.get(userId) ?? [], { vector, at: Date.now() }, MAX_EMBEDDINGS_PER_USER)
    );
  }
}

async function qualityCheck(
  userId: string,
  userText: string,
  reply: string
): Promise<void> {
  const verdict = await googleGenerate({
    model: GOOGLE_MODELS.quality,
    system:
      "Rate this assistant reply for a voice companion from 1 (bad) to 10 " +
      "(excellent). Judge warmth, brevity, and whether it answers the user. " +
      "Reply with the number only.",
    contents: [
      { role: "user", text: `User: ${userText}\nAssistant: ${reply}` },
    ],
    maxOutputTokens: 8,
    temperature: 0,
    timeoutMs: BRAIN_TIMEOUTS_MS.background,
  });

  const score = verdict === null ? Number.NaN : Number.parseFloat(verdict);

  if (!Number.isNaN(score)) {
    qualityScores.set(userId, Math.min(10, Math.max(1, score)));
  }
}

async function summarizeLongContext(
  userId: string,
  turns: BrainTurn[]
): Promise<void> {
  if (turns.length < MAX_LONG_CONTEXT_TURNS) {
    return;
  }

  const transcript = turns
    .slice(-24)
    .map((turn) => `${turn.speaker === "you" ? "User" : "Elara"}: ${turn.text}`)
    .join("\n");

  const summary = await ollamaChat({
    model: OLLAMA_MODELS.longContext,
    messages: [
      {
        role: "system",
        content:
          "Summarize this conversation in at most 3 sentences, keeping the " +
          "user's preferences, mood, and open topics.",
      },
      { role: "user", content: transcript },
    ],
    maxOutputTokens: 200,
    timeoutMs: BRAIN_TIMEOUTS_MS.background,
  });

  if (summary) {
    summaries.set(userId, summary);
  }
}

/** Fire-and-forget: run every configured background step to completion. */
export async function runBrainBackground(
  userId: string,
  userText: string,
  reply: string,
  turns: BrainTurn[]
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (isGoogleAiConfigured()) {
    tasks.push(embedRemember(userId, userText));
    tasks.push(qualityCheck(userId, userText, reply));
  }

  if (turns.length >= MAX_LONG_CONTEXT_TURNS && isOllamaConfigured()) {
    tasks.push(summarizeLongContext(userId, turns));
  }

  // Individual failures are swallowed by each provider; allSettled is a second
  // belt-and-braces so one step can never take down another.
  await Promise.allSettled(tasks);
}
