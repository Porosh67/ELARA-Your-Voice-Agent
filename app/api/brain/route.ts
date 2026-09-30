import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runMainBrain } from "@/lib/brain/main-brain";
import { runBrainBackground } from "@/lib/brain/background";
import { isRateLimited } from "@/lib/brain/rate-limit";
import { isVoiceLanguageCode } from "@/lib/voice/types";
import { containsInjectionAttempt } from "@/lib/brain/safety-policy";
import { SAFE_FALLBACK_REPLY, emptyMeta } from "@/lib/brain/types";
import type {
  BrainResult,
  BrainTurn,
  EmotionHint,
  ReplyLanguage,
} from "@/lib/brain/types";

/**
 * The Main Brain endpoint.
 *
 * SECURITY
 * - `/api` is excluded from the `proxy.ts` matcher, so this handler performs
 *   its own Supabase session check — same defense-in-depth as the voice token
 *   route. All LLM / search keys stay server-side; the browser only ever sees
 *   the final reply text.
 * - Rate limited per user: the brain is expensive and the endpoint is live.
 *   429s carry `Retry-After` so clients back off instead of hammering.
 * - The declared body size is checked BEFORE `request.json()`, because the
 *   per-field caps in `parseBody` only apply after the whole body has already
 *   been buffered into memory.
 * - Client-supplied history is attacker-controlled, so injection-shaped history
 *   turns are dropped before they can be interpolated into a model prompt.
 * - Input is validated and capped before it reaches any model.
 * - The background path runs via `after()`, AFTER the response is sent, so it
 *   can never add latency to the voice loop.
 * - Nothing about the request is logged.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TEXT_CHARS = 1000;
const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 500;

/**
 * Hard ceiling on the request body, enforced before parsing.
 *
 * The validated maximum is ~13 KB (1000 chars of text plus 12 turns of 500
 * chars, plus JSON overhead), so 64 KB is generous while still refusing the
 * multi-megabyte bodies that would otherwise be buffered in full.
 */
const MAX_BODY_BYTES = 64_000;

/** Window used for the `Retry-After` hint on 429, matching the limiter. */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

function jsonError(message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store", ...(headers ?? {}) },
    }
  );
}

interface BrainRequestBody {
  text?: unknown;
  turns?: unknown;
  language?: unknown;
  emotion?: unknown;
}

/** The accepted emotion-hint set — anything else is dropped, never guessed. */
const EMOTION_HINTS: readonly string[] = [
  "low",
  "bright",
  "playful",
  "worried",
];

/** Strict validation — anything malformed is rejected, never coerced. */
function parseBody(
  payload: BrainRequestBody
): {
  text: string;
  turns: BrainTurn[];
  language: ReplyLanguage;
  emotion: EmotionHint | null;
} | null {
  if (typeof payload.text !== "string") {
    return null;
  }

  const text = payload.text.trim();

  if (text.length === 0 || text.length > MAX_TEXT_CHARS) {
    return null;
  }

  // Full-turn language lock decided by the client's Language Locker, validated
  // against the accepted set. Anything else falls back to English — the server
  // never guesses a language from the text itself.
  const language: ReplyLanguage = isVoiceLanguageCode(payload.language)
    ? payload.language
    : "en";

  const emotion: EmotionHint | null =
    typeof payload.emotion === "string" &&
    (EMOTION_HINTS as readonly string[]).includes(payload.emotion)
      ? (payload.emotion as EmotionHint)
      : null;

  if (!Array.isArray(payload.turns)) {
    return { text, turns: [], language, emotion };
  }

  if (payload.turns.length > MAX_HISTORY_TURNS * 2) {
    return null;
  }

  const turns: BrainTurn[] = [];

  for (const entry of payload.turns) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }

    const record = entry as { speaker?: unknown; text?: unknown };
    const speaker = record.speaker;
    const turnText = record.text;

    if (
      (speaker !== "you" && speaker !== "elara") ||
      typeof turnText !== "string" ||
      turnText.length === 0 ||
      turnText.length > MAX_TURN_CHARS
    ) {
      return null;
    }

    turns.push({ speaker, text: turnText });
  }

  // Keep only the most recent window.
  return { text, turns: turns.slice(-MAX_HISTORY_TURNS), language, emotion };
}

export async function POST(request: Request) {
  // 1. Require an authenticated user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("You must be signed in to use the voice brain.", 401);
  }

  // 2. Rate limit per user before touching any model.
  if (isRateLimited(user.id)) {
    return jsonError(
      "You're going fast — give Elara a few seconds to catch up.",
      429,
      { "Retry-After": String(RATE_LIMIT_RETRY_AFTER_SECONDS) }
    );
  }

  // 3. Refuse an oversized body BEFORE it is buffered and parsed. The
  //    per-field caps in `parseBody` can only run once the whole payload is
  //    already in memory, so without this an authenticated caller could force
  //    a multi-megabyte allocation on every request.
  const declaredBytes = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
    return jsonError("That request was too large.", 413);
  }

  // 4. Validate the payload.
  let payload: BrainRequestBody;

  try {
    payload = (await request.json()) as BrainRequestBody;
  } catch {
    return jsonError("Could not read the request.", 400);
  }

  const input = parseBody(payload);

  if (!input) {
    return jsonError("That request didn't look right.", 400);
  }

  /*
   * 5. UNTRUSTABLE HISTORY.
   *
   * The input guard in `runMainBrain` only ever inspects the current
   * `input.text`. History is supplied by the client, so a crafted transcript
   * (fake assistant turns carrying injection payloads) would otherwise be
   * interpolated straight into the model prompt. Drop any injection-shaped
   * turn here — a pure regex filter, no model call, reusing the single
   * definition of an injection shape from `safety-policy`.
   */
  const screenedTurns = input.turns.filter(
    (turn) => !containsInjectionAttempt(turn.text)
  );

  // Everything downstream — the model, the search stage, and the background
  // summary — reads the screened history, never the raw client copy.
  const safeInput = { ...input, turns: screenedTurns };

  // 6. Run the locked critical path — STREAMED.
  /*
   * The response is newline-delimited JSON:
   *
   *   {"type":"progress","phase":"searching"}
   *   {"type":"progress","phase":"searched","found":true|false}
   *   {"type":"done","reply":"…","meta":{…}}
   *
   * The progress lines are what makes "Searching live…" / "Found live
   * results" visible while the request is still open — they carry NO
   * content: never the query, the results, or a provider/model name. Chat
   * turns emit no progress at all and end exactly as the old JSON response
   * did (one `done` line). Error responses still arrive as plain JSON with a
   * non-2xx status, which the client rejects before reading the body.
   */
  let finalResult: BrainResult | null = null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
        } catch {
          // Client gone mid-turn — keep computing so the background path
          // still runs; there is simply nobody left to enqueue to.
        }
      };

      try {
        const result = await runMainBrain(safeInput, (progress) => {
          send({ type: "progress", ...progress });
        });
        finalResult = result;
        send({ type: "done", reply: result.reply, meta: result.meta });
      } catch {
        // runMainBrain fails safe on its own; this is the belt-and-braces so
        // the stream always ends in a speakable line.
        const fallback: BrainResult = {
          reply: SAFE_FALLBACK_REPLY,
          meta: { ...emptyMeta(), fellBack: true },
        };
        finalResult = fallback;
        send({ type: "done", reply: fallback.reply, meta: fallback.meta });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed or errored — nothing left to do.
        }
      }
    },
  });

  // 6. Background path — strictly after the response is sent, never blocking.
  after(async () => {
    if (finalResult !== null) {
      await runBrainBackground(
        user.id,
        safeInput.text,
        finalResult.reply,
        safeInput.turns
      );
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Progress lines must flush as they are produced, never be buffered.
      "X-Accel-Buffering": "no",
    },
  });
}
