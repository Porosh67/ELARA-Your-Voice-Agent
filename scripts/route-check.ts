/**
 * Routing verification for the universal router.
 *
 * Run (live, real models):
 *   node --env-file=.env.local --import ./scripts/test-hooks.mjs scripts/route-check.ts
 *
 * Prints one line per input: the route, the reason, and the resolved query.
 * The inputs below live in THIS TEST FILE ONLY — none of them is referenced by
 * product code, and the product router contains no topic list.
 */
export {}; // top-level await needs this file to be a module

import { routeTurn } from "@/lib/brain/stages/respond";
import { classifyTurnSemantics } from "@/lib/brain/stages/router";
import type { BrainTurn } from "@/lib/brain/types";

interface Case {
  text: string;
  /** Prior conversation, oldest first. */
  history?: BrainTurn[];
  expected: "chat" | "live";
  /** When set, the resolved query must mention all of these fragments. */
  queryMustMention?: string[];
}

/** The battery. Test-only — see the file header. */
const CASES: Case[] = [
  { text: "Hi Elara", expected: "chat" },
  { text: "How are you?", expected: "chat" },
  { text: "Tell me a nice joke", expected: "chat" },
  {
    text: "That's very familiar. Anything new?",
    history: [
      { speaker: "you", text: "Tell me a nice joke" },
      {
        speaker: "elara",
        text: "Why did the scarecrow get a promotion? He was outstanding in his field.",
      },
    ],
    expected: "chat",
  },
  { text: "I'm feeling a little sad", expected: "chat" },
  { text: "Who is the first president of Tokyo?", expected: "chat" },
  { text: "Explain how photosynthesis works", expected: "chat" },
  { text: "What's the weather in Dhaka?", expected: "live" },
  { text: "Dhakay ajker weather kemon?", expected: "live" },
  { text: "Ekhon Tokyo te koyta bajey?", expected: "live" },
  { text: "What's the latest news about OpenAI?", expected: "live" },
  { text: "Who is the best golf player in the world right now?", expected: "live" },
  { text: "Search the latest price of gold", expected: "live" },
  {
    text: "What about tomorrow?",
    history: [
      { speaker: "you", text: "What's the weather in Dhaka?" },
      { speaker: "elara", text: "It's warm and humid in Dhaka right now, around 31 degrees." },
    ],
    expected: "live",
    queryMustMention: ["dhaka", "tomorrow"],
  },
  {
    text: "Thanks, that helps",
    history: [
      { speaker: "you", text: "What's the weather in Dhaka?" },
      { speaker: "elara", text: "It's warm and humid in Dhaka right now, around 31 degrees." },
    ],
    expected: "chat",
  },
];

let pass = 0;
let fail = 0;

for (const testCase of CASES) {
  const history = testCase.history ?? [];

  // 1. The deterministic router alone.
  const deterministic = routeTurn(testCase.text, history);

  // 2. The meaning-based router, which may only PROMOTE.
  const semantic = await classifyTurnSemantics(testCase.text, history);

  const promoted =
    semantic !== null &&
    semantic.confident &&
    semantic.kind === "live" &&
    semantic.query !== null &&
    deterministic.kind !== "block";

  // Mirrors the product: BLOCK wins, a confident semantic LIVE promotes,
  // otherwise the deterministic route stands.
  let effective: "chat" | "live" | "block";
  if (deterministic.kind === "block") {
    effective = "block";
  } else if (promoted || deterministic.kind === "live") {
    effective = "live";
  } else {
    effective = "chat";
  }

  const finalQuery = promoted ? semantic.query : deterministic.query;

  // "ambiguous" and "chat" are both non-live for the purposes of this battery.
  const queryOk =
    testCase.queryMustMention === undefined ||
    (finalQuery !== null &&
      testCase.queryMustMention.every((fragment) =>
        finalQuery.toLowerCase().includes(fragment.toLowerCase())
      ));

  const ok = effective === testCase.expected && queryOk;
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
  }

  console.log(
    JSON.stringify({
      input: testCase.text,
      expected: testCase.expected,
      route: effective,
      why: deterministic.kind === "live" ? `det:${deterministic.reason}` : promoted ? "semantic" : `det:${deterministic.reason}`,
      query: finalQuery,
      ok,
    })
  );
}

console.log(JSON.stringify({ summary: { pass, fail, total: CASES.length } }));
