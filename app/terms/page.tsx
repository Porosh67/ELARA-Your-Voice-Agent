import { LegalList, LegalPage, LegalSection } from "@/components/settings/legal-page";

export const metadata = {
  title: "Terms of use — Elara AI",
  description: "The plain terms for using Elara AI.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="30 September 2026">
      <LegalSection heading="What Elara is">
        <p>
          Elara is a demonstration project built for a hackathon. It is a
          conversational assistant, not a regulated service, and it is not a
          substitute for professional advice of any kind.
        </p>
      </LegalSection>

      <LegalSection heading="Don't rely on it for anything serious">
        <p>
          Elara can be wrong. It is a language model, and it produces fluent text
          whether or not that text is accurate. In particular:
        </p>
        <LegalList>
          <li>
            It is not a medical, legal, financial or safety adviser. Nothing it
            says should be acted on as professional advice.
          </li>
          <li>
            It is not designed for emergency or crisis support. If you are in
            danger, please contact your local emergency services.
          </li>
          <li>
            Anything about the present — prices, scores, news, the weather — is
            looked up at the time you ask. Treat it as a snapshot, not a
            guarantee.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          Elara refuses requests for things that could cause real harm, and it
          does not assist with illegal activity, violence, or anything targeting a
          specific person. Attempts to bypass those limits are not permitted.
        </p>
      </LegalSection>

      <LegalSection heading="Availability">
        <p>
          Elara depends on third-party services for speech recognition, language
          models and web search. Any of them can be slow or unavailable, and
          features can change or be withdrawn without notice. Live search in
          particular depends on a search provider that is not under our control.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>
          You are responsible for what happens under your account, including
          keeping your password to yourself. You can delete your account and all
          of its data at any time from Settings; see the
          <a href="/privacy" className="mx-1 underline underline-offset-4">privacy page</a>
          for exactly what that removes.
        </p>
      </LegalSection>

      <LegalSection heading="No warranty">
        <p>
          Elara is provided as-is, without warranty of any kind. To the extent
          permitted by law, we are not liable for any loss arising from your use
          of it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
