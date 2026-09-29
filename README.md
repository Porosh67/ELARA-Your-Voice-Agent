# Elara AI

Your secure, real-time **voice friend** — a Next.js 16 app with Supabase Auth,
a premium marketing site, and a voice-first product surface.

## Stack

- **Next.js 16** — App Router, Turbopack, `proxy.ts` (the Next 16 successor to `middleware.ts`)
- **React 19** + **TypeScript (strict)**
- **Tailwind CSS v4** — CSS-first `@theme` tokens, class-based dark mode
- **Motion** — animations, globally gated on `prefers-reduced-motion`
- **lucide-react** — icons
- **Supabase** — Auth (email / Google / anonymous) + Postgres with Row Level Security
- **next-themes** — Dark / Light / System theming with no flash on load
- **AssemblyAI** — real-time streaming speech-to-text (`universal-3-5-pro`), reached via a server-minted temporary token
- **Web Audio API + SpeechSynthesis** — microphone capture and voice playback, both browser-native

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase keys
npm run dev
```

Full setup (Supabase project, migration, auth providers, redirect URLs) is in
[`SETUP.md`](./SETUP.md).

## Routes

| Route | Description |
| --- | --- |
| `/` | Landing page — aurora hero, features, security, CTAs (auth-aware header) |
| `/login` · `/signup` | Email + Google + guest sign-in |
| `/app` | Protected app surface — real-time voice loop; redirects to `/login` when unauthenticated |
| `/api/voice/token` | Server route that mints a short-lived AssemblyAI streaming token (401 without a session) |

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # production server
npm run lint    # eslint
```

## Design system

Dark (`#09090b`) / light / system theming with indigo (`#6366f1`) as the brand
color. All tokens live in `app/globals.css` and are exposed to Tailwind v4 via
`@theme inline`, so every utility resolves the active theme at runtime. See the
**Theming** section of [`SETUP.md`](./SETUP.md) for the rules.

## Voice loop (Phase 2, Day 1)

`/app` runs a real-time voice loop: microphone → AssemblyAI streaming STT →
(language-aware) reply → browser speech synthesis. See the
**Voice loop** section of [`SETUP.md`](./SETUP.md) for setup and the language
support matrix.

Requires `ASSEMBLYAI_API_KEY` in `.env.local` (server-only — the browser only
ever receives a short-lived, single-use token). While the key is unset the voice
UI still loads and reports that it is not configured.

The reply brain is currently a placeholder (`lib/voice/stub-brain.ts`); speech
recognition, the state machine, and TTS are the real implementation.
