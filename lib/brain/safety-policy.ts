import "server-only";

import {
  POLICY_HARD_BLOCK_REPLY,
  POLICY_INJECTION_REPLY,
  POLICY_SECRET_REPLY,
} from "@/lib/brain/types";

/**
 * Server-side policy guard — deterministic, model-free, and cheap.
 *
 * WHY DETERMINISTIC
 *
 * Step 1 (Prompt Guard) and Step 5 (safeguard) are the smart half of safety, but
 * both are remote models that can be slow, rate-limited, or unavailable — and
 * the pipeline is deliberately fail-OPEN for ordinary conversation. That is
 * right for chat and wrong for credentials: a request for the server's API keys
 * must never be answered on the strength of a model call that might not have
 * run. This layer needs no key, no network, and no latency, so it can fail
 * CLOSED on the narrow set of things that deserve it.
 *
 * THE BALANCE (this is the whole design)
 *
 *   fail OPEN  for ordinary conversation — greetings, jokes, feelings, opinions,
 *              questions. Nothing here may fire on those, which is why every
 *              rule needs BOTH a subject (a secret-ish noun, a harmful act) AND
 *              an intent shape, instead of matching a bare word.
 *   fail CLOSED for credential requests, prompt-injection attempts, sexual
 *              content involving minors, and instruction-shaped violent or
 *              criminal harm.
 *
 * A false positive here is expensive: it is a refusal, and refusals are exactly
 * what the conversation history must never learn. So the patterns are anchored
 * and narrow by construction.
 */

export type PolicyVerdict = "allow" | "secret" | "injection" | "hard-block";

/* ──────────────────────────────────────────────────────────────────────────
   Subjects and intents
   ────────────────────────────────────────────────────────────────────────── */

/** Things that must never be handed over. */
const SECRET_SUBJECTS =
  /\b(api[\s_-]?keys?|apikeys?|secret[\s_-]?keys?|access[\s_-]?tokens?|auth[\s_-]?tokens?|bearer[\s_-]?tokens?|refresh[\s_-]?tokens?|service[\s_-]?role(?:[\s_-]?keys?)?|private[\s_-]?keys?|credentials?|passwords?|passphrases?|\.env|env[\s_-]?file|environment[\s_-]?variables?|connection[\s_-]?strings?|database[\s_-]?urls?|db[\s_-]?urls?|dsns?)\b/i;

/** Retrieval intent: what makes a secret mention a REQUEST rather than chatter. */
const DISCLOSURE_VERBS =
  /\b(give|gimme|show|tell|reveal|print|send|share|dump|list|read|leak|expose|paste|provide|disclose|hand\s+over|what(?:'s| is| are)|whats|need|want|where\s+are)\b/i;

/**
 * Subjects that are a request on their own.
 *
 * `.env`, an env file, or an environment variable has no conversational use —
 * these are server internals, so mentioning them at all is the request.
 */
const SECRET_ALONE =
  /(\.env\b|env[\s_-]?file|environment[\s_-]?variables?|service[\s_-]?role)/i;

/** Prompt-injection / jailbreak shapes. */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[\s\S]{0,40}\b(previous|prior|earlier|above|all|any|your)\b[\s\S]{0,30}\b(instruction|instructions|prompt|prompts|rule|rules|direction|directions|guideline|guidelines|system)\b/i,
  /\b(reveal|print|show|repeat|output|dump|tell\s+me)\b[\s\S]{0,30}\b(system[\s_-]?prompt|developer[\s_-]?message|initial[\s_-]?instructions?|your[\s_-]?instructions?|hidden[\s_-]?prompt)\b/i,
  /\b(jailbreak|jail\s?break|dan\s+mode|developer\s+mode|god\s+mode|unrestricted\s+mode)\b/i,
  /\b(pretend|act\s+as\s+if|roleplay\s+as)\b[\s\S]{0,40}\b(no\s+rules|no\s+restrictions|without\s+restrictions|no\s+filter|unfiltered|no\s+guidelines)\b/i,
];

/**
 * Sexual content involving minors — the one category with no partial credit.
 * Any co-occurrence of a minor subject and sexual content is a hard block.
 */
const MINOR_SEXUAL_PATTERNS: readonly RegExp[] = [
  /\b(child|children|kid|kids|minor|minors|underage|under[\s-]?age|preteen|pre[\s-]?teen|toddler|infant|schoolgirl|schoolboy|loli|shota)\b[\s\S]{0,60}\b(porn|pornography|sexual|sex|nude|nudes|naked|erotic|molest|groom|explicit|intercourse)\b/i,
  /\b(porn|pornography|sexual|sex|nude|nudes|naked|erotic|molest|groom|explicit|intercourse)\b[\s\S]{0,60}\b(child|children|kid|kids|minor|minors|underage|under[\s-]?age|preteen|pre[\s-]?teen|toddler|infant|schoolgirl|schoolboy|loli|shota)\b/i,
  /\b(csam|child\s+porn)\b/i,
];

/**
 * Doxxing / another person's private personal data.
 *
 * Fail-closed per the locked refuse matrix, but shaped to keep normal chat
 * open: every pattern needs BOTH a discovery/disclosure verb AND a PRIVATE
 * data noun (home address, personal phone, private photos) or an explicit
 * stalking shape ("where does she live"). Public facts ("the address of the
 * Eiffel Tower"), business phone numbers, and "where do YOU live?" aimed at
 * Elara's persona are NOT this shape and stay answerable.
 */
const DOXXING_PATTERNS: readonly RegExp[] = [
  /\b(?:how\s+to\s+doxx?|help\s+me\s+doxx?|doxx?\s+(?:him|her|them|this\s+person|someone))\b/i,
  /\b(?:find|look\s*up|dig\s*up|get|share|post|leak|publish|reveal|send|drop)\b[\s\S]{0,40}\b(?:home\s+address|(?:personal|private|their|her|his)\s+(?:phone|cell|mobile)\s*(?:number)?|private\s+(?:photos|pics|messages|images|nudes))\b/i,
  /\b(?:phone\s*number|address|email|photos|location|ip\s+address)\s+of\s+(?:my|her|his|their|someone|this\s+person|the\s+victim)\b/i,
];

/**
 * Instruction-shaped violent or criminal harm.
 *
 * Anchored on an INSTRUCTION request ("how do I…", "steps to…", "teach me to…")
 * because the subject alone is not the problem — asking what a nerve agent IS
 * is a knowledge question, and Elara should answer it.
 */
const HARMFUL_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(how|steps?|instructions?|guide|recipe|tutorial|teach\s+me|show\s+me|explain\s+how|ways?\s+to)\b[\s\S]{0,50}\b(make|build|construct|manufacture|assemble|cook|synthesize|produce|create|mix)\b[\s\S]{0,40}\b(bomb|explosive|explosives|grenade|detonator|pipe\s+bomb|c4|semtex|nerve\s+agent|sarin|ricin|anthrax|meth|methamphetamine|fentanyl|napalm|thermite)\b/i,
  /\b(how|steps?|instructions?|guide|teach\s+me|tell\s+me\s+how|ways?\s+to|best\s+way\s+to)\b[\s\S]{0,50}\b(kill|murder|assassinate|kidnap|abduct|poison|stab|shoot|strangle|hack\s+into|break\s+into)\b/i,
  /\b(how|steps?|instructions?|guide)\b[\s\S]{0,40}\b(get\s+away\s+with|avoid\s+getting\s+caught|destroy\s+evidence|cover\s+up)\b/i,
  /\b(synthesize|make|produce|cook)\b[\s\S]{0,30}\b(meth|methamphetamine|fentanyl|heroin|cocaine)\b/i,
];

/* ──────────────────────────────────────────────────────────────────────────
   Verdicts
   ────────────────────────────────────────────────────────────────────────── */

/** Turn a verdict into the short line Elara speaks, or `null` to allow. */
export function policyReplyFor(verdict: PolicyVerdict): string | null {
  switch (verdict) {
    case "secret":
      return POLICY_SECRET_REPLY;
    case "injection":
      return POLICY_INJECTION_REPLY;
    case "hard-block":
      return POLICY_HARD_BLOCK_REPLY;
    default:
      return null;
  }
}

/**
 * Classify a user message.
 *
 * Order matters: the hard block is checked first because a message that is both
 * harmful and phrased as a request must never be answered under a softer label.
 */
export function classifyRequest(text: string): PolicyVerdict {
  for (const pattern of MINOR_SEXUAL_PATTERNS) {
    if (pattern.test(text)) {
      return "hard-block";
    }
  }

  for (const pattern of HARMFUL_INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) {
      return "hard-block";
    }
  }

  for (const pattern of DOXXING_PATTERNS) {
    if (pattern.test(text)) {
      return "hard-block";
    }
  }

  if (SECRET_ALONE.test(text)) {
    return "secret";
  }

  /*
   * ORDINARY ACCOUNT TALK IS NOT A SECRET REQUEST.
   *
   * "I need to reset my password" is everyday small talk, and answering it with
   * a refusal is exactly the loop this gate exists to avoid — a refusal in the
   * history teaches the model to decline the next ordinary message too. So the
   * exemption needs BOTH a personal-account verb AND a first-person possessive,
   * it never covers server internals (`SECRET_ALONE` is checked first and has no
   * exemption), and it never applies when the same message also asks for YOUR
   * credentials — "give me your api key" is still refused.
   */
  const personalAccountVerb =
    /\b(?:forgot(?:ten)?|forget|reset|change|update|unlock|locked\s+out|sign\s+in|signing\s+in|log\s*in|logging\s+in|recover|restore)\b/i;
  const firstPersonOwnSecret =
    /\b(?:my|our)\s+(?:[a-z]+\s+){0,3}(?:password|passphrase|username|login|account|pin)\b/i;
  const asksForYourSecret =
    /\byour\b[\s\S]{0,24}\b(?:api[\s_-]?keys?|secret|token|password|credential|passphrase|\.env)/i;

  const ownAccountTalk =
    personalAccountVerb.test(text) &&
    firstPersonOwnSecret.test(text) &&
    !asksForYourSecret.test(text);

  if (
    SECRET_SUBJECTS.test(text) &&
    !ownAccountTalk &&
    (DISCLOSURE_VERBS.test(text) || /\byour\b/i.test(text))
  ) {
    return "secret";
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return "injection";
    }
  }

  return "allow";
}

/**
 * Injection-shaped text only, with no other policy label involved.
 *
 * Used to screen UNTRUSTABLE, client-supplied conversation history before it is
 * interpolated into a model prompt. `classifyRequest` cannot serve that purpose
 * directly: history is not a user request, and applying the full classifier to
 * it would poison the conversation with refusals for turns the user never typed.
 * Reusing the same constant keeps a single definition of "injection shape".
 */
export function containsInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/* ──────────────────────────────────────────────────────────────────────────
   Output side — credential leakage
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Shapes of real credentials.
 *
 * A model has no access to this server's environment, but "no access" is not
 * the same as "cannot guess": a language model asked about keys will sometimes
 * invent a plausible-looking one, and an invented key printed by a voice
 * companion is indistinguishable to the listener from a real leak. So the reply
 * itself is checked before it is spoken.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  // Vendor-prefixed keys.
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgsk_[A-Za-z0-9]{20,}\b/,
  /\bsk_live_[A-Za-z0-9]{16,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bea[a-f0-9]{30,}\b/i,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  // JWTs — the shape Supabase and most auth providers mint.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  // Connection strings that carry an inline password.
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/i,
  // Named server secrets, assigned a value.
  /\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|GROQ_API_KEY|ASSEMBLYAI_API_KEY|GOOGLE_AI_API_KEY|BRIGHTDATA_SERP_TOKEN|OLLAMA_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY)\b\s*[:=]\s*\S+/i,
  // A generic "api key: <long opaque token>" line.
  /\b(?:api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|bearer|password)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{16,}/i,
];

/**
 * True when a reply contains something credential-shaped.
 *
 * Fail-CLOSED: the caller replaces the whole reply with a short spoken refusal
 * rather than redacting, because a half-redacted key still leaks its shape and
 * anything that triggers this is already off-script.
 */
export function containsCredentialLikeText(text: string): boolean {
  return CREDENTIAL_SHAPES.some((pattern) => pattern.test(text));
}
