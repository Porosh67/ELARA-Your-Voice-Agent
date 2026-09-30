/**
 * One real end-to-end LIVE turn through runMainBrain, to prove the whole path
 * (search → grounded synthesis) works against the live provider.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/test-hooks.mjs scripts/live-turn-e2e.ts
 *
 * Reports elapsed time, whether search was used, and the reply. The reply is
 * printed because it is the assistant's own spoken output, not a secret.
 */
export {}; // top-level await needs this file to be a module

import { runMainBrain } from "@/lib/brain/main-brain";

const question = process.argv[2] ?? "What's the weather in Dhaka?";

const startedAt = Date.now();
const result = await runMainBrain({ text: question, turns: [], language: "en" });
const elapsed = Date.now() - startedAt;

console.log(
  JSON.stringify({
    question,
    elapsedMs: elapsed,
    usedSearch: result.meta.usedSearch,
    fastAssist: result.meta.fastAssist,
    reorganized: result.meta.reorganized,
    guardBlocked: result.meta.guardBlocked,
    fellBack: result.meta.fellBack,
    reply: result.reply,
  })
);
