/**
 * Replays a real multi-turn conversation through the LIVE pipeline, keeping the
 * growing history, and prints what each turn decided and said.
 *
 * This is the only way to see the bug the single-turn tests cannot: routing is
 * per-turn, but the MODEL is not — it sees the whole history, so one turn's
 * behaviour can bleed into the next.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/test-hooks.mjs scripts/transcript-replay.ts
 */
export {}; // top-level await needs this file to be a module

import { stageRespond } from "@/lib/brain/stages/respond";
import { routeTurn } from "@/lib/brain/stages/respond";
import type { BrainTurn } from "@/lib/brain/types";

/** The reported conversation, in order. Test-only; not referenced by product code. */
const SCRIPT: { text: string; expect: "chat" | "live" }[] = [
  { text: "Hey, Elara.", expect: "chat" },
  { text: "Tell me the current weather in Tokyo.", expect: "live" },
  { text: "How are you?", expect: "chat" },
  { text: "I said, how are you?", expect: "chat" },
  { text: "Can you tell me the top superstar name in India?", expect: "live" },
  { text: "Tell me, how are you?", expect: "chat" },
  { text: "Can you share me your API key?", expect: "chat" },
  { text: "Tell me the current world condition.", expect: "live" },
  {
    text: "Okay, I come to know about world condition, but tell me about the Bangladesh condition where I lived.",
    expect: "live",
  },
  {
    text: "I can't understand why you sometimes can live search and sometimes not. What's the problem?",
    expect: "chat",
  },
];

const history: BrainTurn[] = [];
let agree = 0;
let disagree = 0;

for (const [index, step] of SCRIPT.entries()) {
  const route = routeTurn(step.text, history);
  let searchAttempted = false;
  const startedAt = Date.now();
  const result = await stageRespond(step.text, history, "en", null, (event) => {
    if (event.phase === "searching") {
      searchAttempted = true;
    }
  });
  const elapsed = Date.now() - startedAt;

  // A turn is "live in practice" if it decided live OR actually reached the
  // search stage. `usedSearch` alone is wrong here: a search that RAN but found
  // nothing reports usedSearch=false, and that is still a live turn.
  const searched = result.usedSearch || searchAttempted;
  const effective: "chat" | "live" = route.kind === "live" || searched ? "live" : "chat";
  const ok = effective === step.expect;
  if (ok) {
    agree += 1;
  } else {
    disagree += 1;
  }

  console.log(
    JSON.stringify({
      turn: index + 1,
      you: step.text,
      expected: step.expect,
      got: effective,
      route: `${route.kind}/${route.reason}`,
      searchAttempted,
      usedSearch: result.usedSearch,
      ms: elapsed,
      ok,
      elara: result.reply,
    })
  );

  history.push({ speaker: "you", text: step.text });
  history.push({ speaker: "elara", text: result.reply });
}

console.log(JSON.stringify({ summary: { agree, disagree, total: SCRIPT.length } }));
