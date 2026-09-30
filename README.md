# Elara AI

Your secure, real-time **voice friend** — a Next.js 16 app with Supabase Auth, a premium marketing site, and a voice-first product surface.

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
- **Groq** — input safety, main response, reorganize, output safety models
- **Google AI Studio** — fast assist (Gemini 3.5 Flash Lite) + embeddings
- **Bright Data** — SERP live search (Light JSON)
- **Ollama Cloud** — fallback reorganize + long-context summaries

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in your keys
npm run dev
```

Full setup (Supabase project, migration, auth providers, redirect URLs) is in [`SETUP.md`](./SETUP.md).

## Routes

| Route | Description |
| --- | --- |
| `/` | Landing page — aurora hero, features, security, CTAs (auth-aware header) |
| `/login` · `/signup` | Email + Google + guest sign-in |
| `/app` | Protected app surface — real-time voice loop; redirects to `/login` when unauthenticated |
| `/api/voice/token` | Server route that mints a short-lived AssemblyAI streaming token (401 without a session) |
| `/api/brain` | Main brain endpoint — streams NDJSON (progress + final reply) |

## Scripts

```bash
npm run dev           # development server
npm run build         # production build
npm run start         # production server
npm run lint          # eslint
npm run test:live-search  # live search regression test
```

## Design system

Dark (`#09090b`) / light / system theming with indigo (`#6366f1`) as the brand color. All tokens live in `app/globals.css` and are exposed to Tailwind v4 via `@theme inline`, so every utility resolves the active theme at runtime. See the **Theming** section of [`SETUP.md`](./SETUP.md) for the rules.

## Voice loop

`/app` runs a real-time voice loop:

```
mic (Web Audio) → PCM16 → AssemblyAI streaming WS → live transcript
                                                      ↓
                              SpeechSynthesis ← Main Brain (5 stages) ←┘
```

The Main Brain is a **locked 5-stage pipeline** (all server-side, keys never leave the server):

1. **Input Safety** — `llama-prompt-guard-2-86m` (Groq) — injection probability, fail-open
2. **Fast Assist** — `gemini-3.5-flash-lite` (Google, 800 ms cap, concurrent, fail-open)
3. **Main Response** — `gpt-oss-120b` (Groq) — Elara personality, optional Bright Data SERP
4. **Reorganize + Emotion** — `qwen/qwen3.8-27b` (Groq, fallback `nemotron-3-nano` on Ollama) — tone polish, anti-echo, length guard
5. **Output Safety** — `gpt-oss-safeguard-20b` (Groq) — one-word verdict, fail-open

**CHAT / LIVE / BLOCK routing** is deterministic (`lib/brain/stages/respond.ts:routeTurn`):
- **CHAT** — answered from memory (greetings, jokes, feelings, opinions)
- **LIVE** — Bright Data SERP lookup + grounded synthesis (weather, time, news, prices, schedules, scores)
- **BLOCK** — deterministic policy gate (secrets, injection, CSAM, doxxing, harmful instructions)

Requires `ASSEMBLYAI_API_KEY` in `.env.local` (server-only — the browser only ever receives a short-lived, single-use token). While the key is unset the voice UI still loads and reports that it is not configured.

## How AssemblyAI is used (for hackathon judges)

- **Server-minted ephemeral tokens**: The browser calls `GET /api/voice/token` (auth-gated, rate-limited, cross-site protected). The server exchanges `ASSEMBLYAI_API_KEY` for a single-use token (60 s TTL, 600 s max session) via `https://streaming.assemblyai.com/v3/token`. The long-lived key never reaches the client.
- **Real-time streaming (v3)**: The client opens a WebSocket to `wss://streaming.assemblyai.com/v3/ws` with the token as a query parameter (the WS API cannot send custom headers). Audio frames (PCM16, 16 kHz, ~100 ms chunks) flow directly from the microphone via an AudioWorklet → WebSocket. No audio is buffered, stored, or logged by Elara.
- **Language detection + keyterms**: The stream is configured with `language_detection: true` and a keyterm list (`Elara`, `Elara's`, common proper nouns) to improve proper-noun accuracy. The model (`universal-3-5-pro`) code-switches across supported languages automatically.
- **Bangla/Banglish fallback**: AssemblyAI has no streaming model for Bengali. When the Language Locker detects Bangla script or ≥2 romanised Bangla markers, the client silently switches to the browser's **Web Speech API** (Chrome/Edge) for STT. This audio is processed by the browser vendor, not AssemblyAI.
- **Session hygiene**: Every session sends a `Terminate` frame on close (AssemblyAI bills per session duration). A 10 s silence timeout auto-stops the session. Stop/Restart uses epoch guards to prevent ghost turns/replies.

## Honest limitations

- **Bangla STT uses the browser Web Speech API**, not AssemblyAI. That audio is processed by the browser vendor (Chrome/Edge). The UI discloses this when active.
- **Rate limiter** (`lib/brain/rate-limit.ts`) and **background memory** (`lib/brain/background.ts`) are **process-local in-memory Maps**. They reset on cold starts and do not scale across instances. Behind a load balancer the effective ceiling is N× the configured limit.
- **Memory is not persistent across sessions**. Background embeddings, quality scores, and summaries live only in the current process and are evicted at 5,000 users / 50 embeddings per user. No vector DB is configured.
- **TTS is browser SpeechSynthesis only**. Voice availability varies by OS/browser; the UI checks and reports missing voices honestly.

## Privacy

- Elara does not store audio. Audio is sent to **AssemblyAI** (English flow) or the **browser speech engine** (Bangla flow) for transcription.
- No `MediaRecorder` is used; frames stream directly to the WebSocket.
- The streaming session is always closed with a `Terminate` frame.
- Supabase RLS is enabled on all tables; users can only ever read/write their own rows.
- API keys (Groq, Google, AssemblyAI, Bright Data, Ollama) are server-only (`import "server-only"`).

---

**Built for the AssemblyAI Hackathon** — real-time streaming STT, deterministic live search routing, and a locked 5-stage brain pipeline.