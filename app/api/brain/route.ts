import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runMainBrain } from "@/lib/brain/main-brain";
import { runBrainBackground } from "@/lib/brain/background";
import { isRateLimited } from "@/lib/brain/rate-limit";
import { isVoiceLanguageCode } from "@/lib/voice/types";
import type { BrainTurn, EmotionHint, ReplyLanguage } from "@/lib/brain/types";

/**
 * The Main Brain endpoint.
 *
 * SECURITY
 * - `/api` is excluded from the `proxy.ts` matcher, so this handler performs
 *   its own Supabase session check — same defense-in-depth as the voice token
 *   route. All LLM / search keys stay server-side; the browser only ever sees
 *   the final reply text.
 * - Rate limited per user: the brain is expensive and the endpoint is live.
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

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
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
      429
    );
  }

  // 3. Validate the payload.
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

  // 4. Run the locked critical path.
  const result = await runMainBrain(input);

  // 5. Background path — strictly after the response is sent, never blocking.
  after(async () => {
    await runBrainBackground(user.id, input.text, result.reply, input.turns);
  });

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
