# Elara AI — Setup Guide

This guide covers the **auth + database foundation**, the **premium UI shell**
(landing page, auth pages, Dark/Light/System theming), and **Phase 2 Day 1 —
the real-time voice loop** (AssemblyAI streaming STT + browser SpeechSynthesis).
The reply brain (Groq) is intentionally **not** implemented yet; see
[Voice loop](#7-voice-loop-phase-2-day-1) below.

---

## 1. Create / open a Supabase project

1. Go to https://supabase.com/dashboard and create a new project (or open an
   existing one).
2. Note your **Project URL** and **anon public key** — found under
   **Project Settings → API**.

## 2. Configure environment variables

```bash
# from the elara-ai/ directory
cp .env.local.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | Public, safe for browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon public | Public, safe for browser (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role | **SERVER-ONLY. Never expose to the browser.** |
| `NEXT_PUBLIC_SITE_URL` | Your own deployment origin | Origin used to build Google/email redirect URLs. Defaults to `http://localhost:3000` |
| `ASSEMBLYAI_API_KEY` | [AssemblyAI dashboard](https://www.assemblyai.com/dashboard) | **SERVER-ONLY. Never expose to the browser.** Required for the voice loop; while empty the voice UI loads and reports "not configured". |

> `.env.local` is git-ignored. `.env.local.example` is the committed template.

## 3. Run the database migration

1. Open **Supabase Dashboard → SQL Editor → New query**.
2. Paste the full contents of
   [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql).
3. Click **Run**.

This creates:

- `public.profiles`, `public.settings`, `public.conversations`, `public.messages`
- Row Level Security (RLS) policies on **all** tables
- A `handle_new_user()` trigger that auto-creates a profile + default settings
  row for every new user (including guests)

## 4. Enable authentication providers

### Email (default)
Already enabled. If you want to skip the email-confirmation step during the
hackathon demo:

- **Authentication → Sign In / Providers → Email → disable "Confirm email"**.

(The UI handles both cases: if confirmation is required, signup shows a
"check your email" message instead of logging in immediately.)

### Google OAuth
1. Create an OAuth client in the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add an **Authorized redirect URI**:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. In Supabase: **Authentication → Sign In / Providers → Google**, enable it and
   paste the **Client ID** and **Client Secret**.

### Anonymous (Guest) sign-in
- **Authentication → Sign In / Providers → Anonymous** → enable.

Guest users get a real Supabase user row with `is_anonymous = true`; our
`handle_new_user` trigger flags them with `profiles.is_guest = true`.

## 5. Configure redirect URLs

Under **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/auth/callback`

(For production, add your deployed domain equivalents.)

> The app builds its Google/email redirect URLs from `NEXT_PUBLIC_SITE_URL`
> (see `.env.local.example`). That value must match the Supabase **Site URL**
> and the origin of your Google redirect URI, or OAuth will bounce.

---

## 6. Run the app

```bash
npm run dev
```

> **Windows note:** if `npx` fails with an execution-policy error
> (`npx.ps1 cannot be loaded because running scripts is disabled`), invoke it
> through `cmd /c` instead — e.g. `cmd /c "npx tsc --noEmit"`.

- `/` — landing page (public). The header and CTAs are **auth-aware**: a
  signed-in visitor sees "Open Elara" and the primary CTA points at `/app`.
- `/signup` — create account (email, Google, or guest)
- `/login` — log in (email, Google, or guest)
- `/app` — **protected**; redirects to `/login` when unauthenticated
- The theme toggle (Light / System / Dark) is available in the header, the
  auth pages, the footer, and `/app`.

---

## 7. Voice loop (Phase 2, Day 1)

The voice loop runs entirely on `/app`, behind auth:

```
mic (Web Audio)  →  PCM16  →  AssemblyAI streaming WS  →  live transcript
                                                              ↓
                              SpeechSynthesis  ←  stub reply ←┘
```

**Statuses:** Idle → Listening → Thinking → Speaking → (back to Listening), plus
Error. Every state is handled by `components/app/voice-status-pill.tsx`.

### Language support (read this before promising Bangla)

`lib/voice/languages.ts` is the single source of truth, modelled by capability:

| Language | Real-time (streaming) | Notes |
| --- | --- | --- |
| English | ✅ `universal-3-5-pro` | Recommended AssemblyAI voice-agent model, sub-300 ms |
| বাংলা (Bengali) | ❌ | No AssemblyAI **streaming** model supports Bengali. It exists only on the pre-recorded `universal-2` model, in the lowest accuracy bucket (>50% WER). |

The UI shows Bengali disabled with that reason rather than silently failing.
Adding Bengali later is a data change in `languages.ts`, not a refactor.

### How the key stays server-side

1. The browser calls `GET /api/voice/token`.
2. That route **verifies the Supabase session** (it must — `/api` is excluded from
   the `proxy.ts` matcher), then exchanges `ASSEMBLYAI_API_KEY` for a temporary
   token over `GET https://streaming.assemblyai.com/v3/token`.
3. The browser receives only that token and passes it as the `token` query
   parameter on the WebSocket (the WebSocket API cannot send custom headers).

`ASSEMBLYAI_API_KEY` lives in `lib/voice/env.ts`, which starts with
`import "server-only"`, so importing it from a Client Component is a **build
error**. The token is single-use and expires in 60 seconds.

### Privacy

- Audio is captured with the Web Audio API and streamed straight to AssemblyAI.
  It is never buffered, stored, or logged by Elara, and no `MediaRecorder` is used.
- The microphone is requested only after an explicit button press, and only on a
  secure origin (HTTPS or `localhost`).
- The streaming session is always closed with a `Terminate` frame, because
  AssemblyAI bills per session duration rather than per audio sent.

**Honest caveat:** audio *is* transmitted to AssemblyAI for transcription — this
is unavoidable for cloud STT. What Elara guarantees is that it never stores or
logs it. AssemblyAI's own retention policy governs their side.

---

## Architecture notes

### Next.js 16 specifics
- The session-refresh + route-guard logic lives in **`proxy.ts`** at the project
  root. In Next.js 16 this file convention replaced `middleware.ts` (the
  exported function is `proxy`, not `middleware`).
- `cookies()` is **async** in Next 16 — the server client awaits it.

### Theming
- Dark / Light / System is driven by `next-themes`
  (`components/theme/theme-provider.tsx`), which writes `.dark` on `<html>`
  with no flash of the wrong theme.
- All design tokens live in `app/globals.css` — `:root` for light and `.dark`
  for dark — and are exposed to Tailwind CSS v4 through `@theme inline`, so
  every utility resolves the **active** theme at runtime.
- Brand colors: `--primary: #6366f1` (indigo) in both themes; dark canvas is
  `#09090b`.
- Always use the token utilities (`bg-card`, `text-muted-foreground`,
  `border-border`, …). Avoid hardcoded values like `text-zinc-400` or
  `bg-white/[0.03]`, which break the light theme.
- All Motion animations respect the OS reduced-motion setting globally via
  `<MotionConfig reducedMotion="user" />`; pure-CSS animations are covered by a
  `prefers-reduced-motion` block in `globals.css`.

### Security model
- API keys are never exposed to the frontend. Only the public anon key is used
  in the browser; it is protected by RLS.
- The service-role key is imported **only** via `lib/supabase/admin.ts`, which
  starts with `import "server-only"` so it can never be bundled into client code.
- No audio is ever stored.
- RLS is enabled on every table; users can only ever read/write their own rows.
- Authorization is enforced in **two** places: `proxy.ts` (UX redirect) and
  server-side inside `/app` (defense-in-depth), per Next.js guidance.

### File map
```
proxy.ts                          Session refresh + /app route guard
app/globals.css                   Design tokens (light + dark), utilities, keyframes
app/layout.tsx                    Fonts, ThemeProvider, metadata, skip link
app/page.tsx                      Landing page (auth-aware CTAs)
app/(auth)/{login,signup}         Auth pages (shared AuthShell)
app/auth/callback/route.ts        OAuth + email code exchange
app/app/page.tsx                  Protected page (server-guarded)
components/theme/*                next-themes provider + Light/System/Dark toggle
components/layout/*               Site header (auth-aware), mobile nav, footer, logo
components/landing/*              Hero + voice orb, stats, features, how-it-works,
                                  security, final CTA
components/auth/*                 Auth shell/card/form/inputs, OAuth + guest buttons
components/ui/*                   Button, glass card, spotlight card, reveal, badge,
                                  section, stat, icon tile, aurora background
lib/supabase/env.ts               Validated env access (+ server-only guard)
lib/supabase/client.ts            Browser client
lib/supabase/server.ts            Server client (async cookies)
lib/supabase/proxy.ts             updateSession() helper
lib/supabase/admin.ts             Service-role client (server-only)
lib/auth/actions.ts               sign in/up, Google, guest, sign out
lib/utils.ts                      cn() class merge helper
hooks/useReducedMotion.ts         Reduced-motion flag (useSyncExternalStore)
hooks/useScrolled.ts              Sticky-header scroll state
supabase/migrations/0001_init.sql Schema + RLS + triggers
types/database.ts                 DB row types
app/api/voice/token/route.ts      Auth-gated AssemblyAI token mint (server)
lib/voice/env.ts                  Server-only AssemblyAI key access
lib/voice/languages.ts            Language lock — capability-aware (EN/BN)
lib/voice/types.ts                Voice status + AssemblyAI message types
lib/voice/pcm-recorder.ts         Mic → PCM16 (AudioWorklet, SP fallback)
lib/voice/assemblyai-stream.ts    Typed v3 streaming WebSocket client
lib/voice/speech.ts               Browser SpeechSynthesis wrapper (TTS)
lib/voice/stub-brain.ts           Placeholder reply (Groq brain pending)
hooks/useVoiceSession.ts          Voice state machine (the loop)
components/app/voice-console.tsx  Voice UI on /app
components/app/voice-status-pill.tsx  Idle/Listening/Thinking/Speaking/Error
```