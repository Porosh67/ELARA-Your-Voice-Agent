/**
 * Speech biasing for the AssemblyAI stream — keyterm (word) boosting.
 *
 * LIVE BUG THIS FIXES: "Hi Elara" was transcribed as "Hi, Ilara". The product
 * name is an out-of-vocabulary proper noun for an acoustic model, so it is
 * guessed from phonetics. AssemblyAI's documented remedy is `keyterms_prompt`
 * (an explicit list of terms to bias recognition toward) plus an optional
 * contextual `prompt` describing the domain of the audio.
 *
 * Both are applied with a documented `UpdateConfiguration` message the moment
 * the session begins. That message takes a real JSON array, so the terms are
 * unambiguous — unlike guessing how an array is serialised into a query string.
 *
 * Budget discipline: the term list is deliberately tiny. Over-boosting is a real
 * cost — a long list makes the model hear listed words that were never spoken —
 * so this holds only the product name, the platform names in the demo, and the
 * two words the Bangla demo leans on.
 *
 * Nothing here is secret and nothing is persisted; it is sent only over the
 * already-authenticated socket.
 */

export const SPEECH_KEYTERMS: readonly string[] = [
  "Elara",
  "ELARA",
  "Elara AI",
  "AssemblyAI",
  "Supabase",
  "Bangla",
  "Banglish",
  "Dhaka",
];

/**
 * Contextual prompt — domain/scenario level, per AssemblyAI's guidance to use
 * the least specific description that covers the use case. It carries CONTEXT
 * about the audio, never instructions (formatting commands are unsupported).
 */
export const SPEECH_DOMAIN_PROMPT = [
  "Casual real-time voice chat with Elara, a warm AI voice companion.",
  "The person speaks their chosen conversation language — often English,",
  "sometimes Bangla or another supported language.",
].join(" ");

/** The exact JSON payload AssemblyAI documents for mid-stream reconfiguration. */
export interface SttUpdateConfiguration {
  type: "UpdateConfiguration";
  prompt: string;
  keyterms_prompt: string[];
}

export function sttConfigurationMessage(): string {
  const payload: SttUpdateConfiguration = {
    type: "UpdateConfiguration",
    prompt: SPEECH_DOMAIN_PROMPT,
    keyterms_prompt: [...SPEECH_KEYTERMS],
  };

  return JSON.stringify(payload);
}
