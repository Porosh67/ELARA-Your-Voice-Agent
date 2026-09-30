import { LegalList, LegalPage, LegalSection } from "@/components/settings/legal-page";

export const metadata = {
  title: "About Elara AI",
  description:
    "What Elara is, how the voice loop works, and what it deliberately does not do.",
};

export default function AboutPage() {
  return (
    <LegalPage title="About Elara" updated="30 September 2026">
      <LegalSection heading="What Elara is">
        <p>
          Elara is a voice-first assistant. You tap once and talk; it listens,
          thinks, and answers out loud in the same language you used. It is built
          as a demonstration of real-time streaming speech recognition — most of
          the engineering is in making a conversation feel immediate rather than
          in making it clever.
        </p>
      </LegalSection>

      <LegalSection heading="How the voice loop works">
        <LegalList>
          <li>
            Your microphone is captured through the browser&apos;s Web Audio API
            and streamed directly to a speech-to-text service as small audio
            frames. Nothing is buffered to disk.
          </li>
          <li>
            Transcripts appear as you speak, and Elara locks onto the language you
            are using — including Bengali and romanised Bengali (Banglish) — and
            replies in it without being asked.
          </li>
          <li>
            The reply is produced by a five-stage pipeline on the server: an
            input safety check, a fast first draft, a main response, a tone
            pass, and an output safety check.
          </li>
          <li>
            The reply is spoken by your browser&apos;s own speech synthesiser.
            There is no server-side voice cloning and no stored audio of any kind.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="When Elara looks things up">
        <p>
          Some questions cannot be answered from memory — the weather, news,
          scores, prices, the time somewhere else. Elara decides which is which
          from the meaning of what you said, in any language, and searches the web
          before answering. The answer is built only from what the search returned,
          so it cannot invent a number, a temperature or a headline.
        </p>
        <p>
          When a search fails, Elara says so plainly rather than guessing. That is
          a deliberate choice: a confident wrong answer is worse than an honest
          &quot;I can&apos;t check that right now&quot;.
        </p>
      </LegalSection>

      <LegalSection heading="What it will not do">
        <LegalList>
          <li>
            It does not take actions on your device or on other websites. It
            cannot open a browser, read your files, send email, or make a
            purchase. There is no code in it that can.
          </li>
          <li>
            It does not invent current facts. A question that needs fresh
            information is either answered from a real search or declined.
          </li>
          <li>
            It does not answer from a fixed script of topics. There is no list of
            cities, sports or celebrities it was taught — it routes on meaning, so
            it can handle a subject nobody anticipated.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="Languages">
        <p>
          Elara speaks and understands English, Bengali, Banglish and a range of
          other languages, chosen automatically per turn. Bengali has no
          real-time streaming model available, so for Bengali Elara uses your
          browser&apos;s built-in recognition instead — which means your browser
          vendor processes that audio. The app tells you when it is doing this.
        </p>
      </LegalSection>

      <LegalSection heading="Built for the AssemblyAI Hackathon">
        <p>
          The streaming voice pipeline, the multi-language handling and the live
          search routing are the substance of the project. The
          <a href="/privacy" className="mx-1 underline underline-offset-4">privacy page</a>
          describes exactly what is stored, because a voice assistant that claims
          to remember nothing while quietly writing transcripts to a database is
          not worth having.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
