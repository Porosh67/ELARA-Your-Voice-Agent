"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ConversationRecorder } from "@/lib/data/conversation-recorder";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle } from "lucide-react";
import { VoiceOrb } from "@/components/app/voice-orb";
import { VoiceStatusPill } from "@/components/app/voice-status-pill";
import { EASE_OUT } from "@/components/ui/reveal";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import {
  hasVoiceForLanguage,
  isSpeechSynthesisSupported,
  warmupVoices,
} from "@/lib/voice/speech";
import { getVoiceLanguage } from "@/lib/voice/languages";
import type { TranscriptTurn, VoiceStatus } from "@/lib/voice/types";
import { cn } from "@/lib/utils";

/**
 * The real-time voice console.
 *
 * speak → AssemblyAI streaming STT → Main Brain (server-side pipeline) →
 * browser SpeechSynthesis. The reply brain runs entirely on the server; see
 * `lib/brain/main-brain.ts`.
 *
 * The surface is deliberately spare: one orb that doubles as the start/stop
 * control, a whisper-quiet status dot, and the transcript. The Language Locker
 * runs under the hood — English and Bangla are locked per turn from the speech
 * itself — so there are no language chips to explain and the card stays a
 * single focused object.
 */

/** One short caption per state — never a paragraph. */
const STATUS_CAPTIONS: Record<VoiceStatus, string> = {
  idle: "Tap the orb to begin.",
  connecting: "Opening the microphone…",
  listening: "Listening — tap the orb to stop.",
  thinking: "Thinking…",
  searching: "Searching live…",
  "search-found": "Found live results",
  speaking: "Speaking — tap the orb to stop.",
  error: "Tap the orb to try again.",
};

/* ──────────────────────────────────────────────────────────────────────────
   Transcript
   ────────────────────────────────────────────────────────────────────────── */

function TurnBubbleComponent({ turn }: { turn: TranscriptTurn }) {
  const isUser = turn.speaker === "you";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={cn(
        "flex flex-col gap-2",
        isUser ? "items-end" : "items-start",
      )}
    >
      <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
        <span
          aria-hidden="true"
          className={cn(
            "h-1 w-1 rounded-full",
            isUser ? "bg-muted-foreground/50" : "bg-primary/60",
          )}
        />
        {isUser ? "You" : "Elara"}
      </span>
      <p
        className={cn(
          "max-w-[85%] rounded-2xl border px-4 py-3 text-sm leading-[1.7]",
          isUser
            ? "rounded-br-md border-border/70 bg-surface-muted/40 text-foreground/90"
            : "rounded-bl-md border-primary/25 bg-primary/10 text-foreground shadow-[0_14px_36px_-22px_var(--glow)]",
        )}
      >
        {turn.text}
      </p>
    </motion.div>
  );
}

/**
 * A finalized turn, memoized: a new turn only re-renders ITS own bubble.
 *
 * The console re-renders on every status flip and (coalesced) partial revision;
 * without this, each of those renders would re-run every bubble's spring
 * animation setup in the list above it.
 */
const TurnBubble = memo(TurnBubbleComponent);

/* ──────────────────────────────────────────────────────────────────────────
   Live (still-revising) utterance
   ────────────────────────────────────────────────────────────────────────── */

function LivePartialBubbleComponent({
  text,
  prefersReducedMotion,
}: {
  text: string;
  prefersReducedMotion: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="flex flex-col items-end gap-2"
    >
      <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
        <span
          aria-hidden="true"
          className={cn(
            "h-1 w-1 rounded-full bg-primary/50",
            !prefersReducedMotion && "animate-breathe",
          )}
        />
        You · live
      </span>
      <p className="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-border/70 bg-surface-muted/30 px-4 py-3 text-sm italic leading-[1.7] text-muted-foreground">
        {text}
        <span
          aria-hidden="true"
          className={cn(
            "ml-1 inline-block h-3.5 w-[2px] translate-y-[2px] rounded-full bg-primary/60",
            !prefersReducedMotion && "animate-breathe",
          )}
        />
      </p>
    </motion.div>
  );
}

/**
 * The live utterance is its own memoized component so a partial revision only
 * re-renders THIS bubble (the text prop moving is the one legitimate reason to
 * do work) instead of the whole console subtree — the bubbles, the pill and the
 * orb all stay put while someone is still talking.
 */
const LivePartialBubble = memo(LivePartialBubbleComponent);

/* ──────────────────────────────────────────────────────────────────────────
   The console
   ────────────────────────────────────────────────────────────────────────── */

/** `true` after hydration only — keeps SSR and first client render identical. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function VoiceConsole({
  userId,
  memoryEnabled,
  displayName,
}: {
  /** The signed-in user, for saving turns. Absent on a public preview. */
  userId?: string;
  /** Mirrors settings.memory_enabled — turning it off stops new writes at once. */
  memoryEnabled?: boolean;
  /** Used to name the conversation this session creates. */
  displayName?: string;
}) {
  /*
   * CONVERSATION RECORDING.
   *
   * The console is the only place that knows about persistence, and the voice
   * hook the only place that knows about audio — they meet at this one observer
   * object. Every handler here is fire-and-forget by contract, and the recorder
   * swallows its own failures, so nothing below can stall or break a reply.
   *
   * Both refs are written in effects, never during render, so the React
   * compiler's ref rules hold and a discarded render cannot leak a recorder.
   */
  const [recorder, setRecorder] = useState<ConversationRecorder | null>(null);
  const memoryEnabledRef = useRef(memoryEnabled ?? true);

  useEffect(() => {
    memoryEnabledRef.current = memoryEnabled ?? true;
  }, [memoryEnabled]);

  useEffect(() => {
    if (userId === undefined) {
      return;
    }

    setRecorder(
      new ConversationRecorder({
        userId,
        // Read through a ref, so toggling the preference takes effect on the
        // very next turn instead of needing the recorder to be rebuilt.
        memoryEnabled: () => memoryEnabledRef.current,
      })
    );
  }, [userId]);

  const observer = useMemo(
    () => ({
      onSessionStart: () => {
        // Not awaited: a slow insert must not delay the first utterance.
        void recorder?.start(
          displayName === undefined ? undefined : `Chat with ${displayName}`,
          "en"
        );
      },
      onUserTurn: (text: string) => {
        recorder?.record("user", text);
      },
      onAssistantTurn: (text: string) => {
        recorder?.record("assistant", text);
      },
    }),
    [recorder, displayName]
  );

  const {
    status,
    errorMessage,
    turns,
    partialTranscript,
    language,
    languageNotice,
    isActive,
    prefetch,
    start,
    stop,
    clearTranscript,
  } = useVoiceSession({ observer });

  const transcriptBoxRef = useRef<HTMLDivElement>(null);
  /** Zero-height marker above the control cluster — leaves the top of the
   *  viewport exactly when the cluster becomes pinned. */
  const clusterSentinelRef = useRef<HTMLDivElement>(null);
  const [clusterPinned, setClusterPinned] = useState(false);
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();
  const ttsUnsupported = mounted && !isSpeechSynthesisSupported();

  /*
   * Voice availability for the language currently in use. Browser TTS is the
   * only speaker, and a device may simply have no voice for the language it is
   * asked to speak - which is exactly why Bangla text could appear with no
   * sound. Checking up front lets the console say so plainly instead of leaving
   * the person wondering whether Elara is broken.
   */
  const [voiceAvailable, setVoiceAvailable] = useState(true);

  useEffect(() => {
    if (!mounted || !isSpeechSynthesisSupported()) {
      return;
    }

    let cancelled = false;

    void hasVoiceForLanguage(getVoiceLanguage(language).ttsLang).then(
      (available) => {
        if (!cancelled) {
          setVoiceAvailable(available);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [mounted, language]);

  /*
   * TTS WARMUP — as soon as the console is on screen.
   *
   * Reading the platform's voice list (and letting the synthesiser load it) is
   * work that would otherwise land on the FIRST reply's critical path, where it
   * reads as Elara "thinking" for an extra beat before she speaks. Warming it
   * here — and again at session start inside the hook — means the first syllable
   * is never waiting on an asynchronous platform call. The hook's own session
   * start warms it again in case this mount ran before speech synthesis was
   * ready.
   */
  useEffect(() => {
    if (!mounted || !isSpeechSynthesisSupported()) {
      return;
    }

    warmupVoices();
  }, [mounted]);

  /*
   * AUTO-SCROLL — and only the transcript moves.
   *
   * The scroll box owns its scrollbar: `scrollIntoView` used to pull every
   * scrollable ancestor along with it, so each new turn dragged the whole page
   * — and the orb with it — downward. That was the scroll fight: talking pushed
   * the mic out of reach. Now the page never moves, and a person who has
   * scrolled up to re-read is never yanked back down — the box follows only
   * while they are already near its own bottom.
   */
  /**
   * Follow the newest content unless the person has scrolled away.
   *
   * Starts `true`: a box that has never been scrolled has not been scrolled
   * AWAY. Only real scroll events of this box can change it — content growth
   * never fires a scroll event, so a tall new turn can no longer be misread
   * as the person pulling up to re-read (which used to switch following off
   * permanently after the first reply).
   */
  const followTranscriptRef = useRef(true);

  // The >96px "scrolled away" test reads scroll position only, in this box's
  // own coordinate space — never the page's.
  useEffect(() => {
    const box = transcriptBoxRef.current;

    if (box === null) {
      return;
    }

    const onScroll = () => {
      const distanceFromBottom =
        box.scrollHeight - box.scrollTop - box.clientHeight;

      followTranscriptRef.current = distanceFromBottom <= 96;
    };

    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, []);

  // Container-scoped auto-scroll: only this box moves, so the page — and the
  // sticky orb — never shift. Scroll is INSTANT on purpose: a smooth scroll is
  // still travelling when the next turn lands, and reading its position
  // mid-flight looks like "scrolled away" and would stop the follow dead.
  useEffect(() => {
    const box = transcriptBoxRef.current;

    if (box === null || !followTranscriptRef.current) {
      return;
    }

    box.scrollTo({ top: box.scrollHeight, behavior: "auto" });
  }, [turns, partialTranscript]);

  /*
   * Whether the sticky control cluster is actually pinned. Its backdrop is
   * applied only then, so the resting card keeps its clean, panel-free look.
   */
  useEffect(() => {
    const sentinel = clusterSentinelRef.current;

    if (
      !mounted ||
      sentinel === null ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setClusterPinned(!entry.isIntersecting),
      { rootMargin: "-1px 0px 0px 0px" },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [mounted]);

  const hasTranscript = turns.length > 0 || partialTranscript.length > 0;

  // The orb is the only control: tap to start, tap again to stop.
  // Stable identity, so the memoized orb does not re-render with the console.
  const handleToggle = useCallback(() => {
    if (isActive) {
      stop();
      return;
    }

    void start();
  }, [isActive, start, stop]);

  return (
    <div className="w-full max-w-xl">
      <div className="relative isolate rounded-[28px] border border-border glass p-8 shadow-[0_30px_90px_-45px_rgba(0,0,0,0.7),0_0_90px_-45px_var(--glow)] hairline-sheen sm:p-10">
        {/*
          Decorative layer — the ONLY clipped box on the card. Keeping
          `overflow-hidden` on the card itself would make the card the sticky
          ancestor of the mic cluster below, and a clipped ancestor that never
          scrolls silently disables stickiness; so the clip moves onto the
          ornament (same rounded rect, same geometry) and the content stays
          free to pin against the page.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]"
        >
          {/* Ambient accent, so the card never reads as a flat rectangle. */}
          <span
            className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-[radial-gradient(60%_100%_at_50%_100%,var(--glow),transparent_70%)] opacity-60"
          />

          {/* Drifting aurora + film grain — depth without weight. */}
          <span
            className={cn(
              "pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,var(--aurora-2),transparent_70%)] opacity-70 blur-3xl",
              !prefersReducedMotion && "animate-aurora",
            )}
          />
          <span
            className={cn(
              "pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,var(--aurora-3),transparent_70%)] opacity-60 blur-3xl",
              !prefersReducedMotion && "animate-aurora",
            )}
            style={{ animationDelay: "-9s" }}
          />
          <span className="noise pointer-events-none absolute inset-0 opacity-[0.05]" />
        </div>

        <div className="relative flex flex-col items-center">
          {/*
            Zero-height marker: when it leaves the top of the viewport, the
            cluster below has become pinned.
          */}
          <div
            ref={clusterSentinelRef}
            aria-hidden="true"
            className="h-px w-full"
          />

          {/*
            STICKY MIC/ORB — the control never scrolls away from the
            conversation. On a tall viewport this cluster simply sits above the
            transcript; when the card is taller than the screen it pins to the
            top, so start/stop is always reachable without scrolling past the
            words. Its backdrop appears only while it is actually pinned (see
            `clusterPinned`), so the resting card stays as spare as before.
          */}
          <div
            className={cn(
              "sticky top-3 z-20 flex w-full flex-col items-center transition-colors duration-200",
              clusterPinned &&
                "rounded-3xl bg-background/70 py-3 shadow-[0_18px_40px_-30px_rgba(0,0,0,0.8)] backdrop-blur-md",
            )}
          >
            {/* Language is locked per turn — from the speech itself, or from an
                instruction like "reply in Spanish" — and matched automatically,
                so there is no picker to explain. This badge is read-only: it
                shows what she is listening for and replying in. */}
            <div className="flex w-full items-center justify-center">
              <span
                title="Locked for this turn — from your speech, or from a request like “reply in Spanish”"
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface-muted/40 px-3 py-1 text-[11px] font-medium text-foreground/80"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isActive ? "bg-primary" : "bg-muted-foreground/50",
                    isActive && !prefersReducedMotion && "animate-breathe",
                  )}
                />
                {getVoiceLanguage(language).label}
                <span className="sr-only">
                  - from your speech or an explicit request, matched in every
                  reply
                </span>
              </span>
            </div>

            <VoiceStatusPill status={status} />

            {/*
              Approaching the orb (hover, or keyboard focus reaching it) mints
              the next session's streaming token, so the tap that follows has
              one less round trip on the critical path. `prefetch` is a no-op
              while a session is live or while a token is already held.
            */}
            <div className="mt-7" onPointerEnter={prefetch} onFocus={prefetch}>
              <VoiceOrb
                status={status}
                isActive={isActive}
                onToggle={handleToggle}
                disabled={ttsUnsupported}
              />
            </div>

            <p
              aria-hidden="true"
              className="mt-6 h-5 text-center text-sm text-muted-foreground"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={status}
                  className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                >
                  {STATUS_CAPTIONS[status]}
                </motion.span>
              </AnimatePresence>
            </p>
          </div>

          {/* Transcript — quiet until there is something to show. */}
          <div className="mt-10 w-full">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">
                Transcript
              </h2>

              {hasTranscript ? (
                <button
                  type="button"
                  onClick={clearTranscript}
                  className="rounded-full px-2 py-1 text-[11px] text-muted-foreground/70 transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div
              ref={transcriptBoxRef}
              className="mt-3 max-h-[min(18rem,40vh)] min-h-32 overflow-y-auto rounded-2xl border border-border/60 bg-surface-muted/25 p-5 shadow-[inset_0_1px_0_0_var(--inset-highlight)]"
            >
              {hasTranscript ? (
                <div className="flex flex-col gap-5">
                  {turns.map((turn) => (
                    <TurnBubble key={turn.id} turn={turn} />
                  ))}

                  {/* Live, still-revising utterance from the STT stream. */}
                  {partialTranscript ? (
                    <LivePartialBubble
                      text={partialTranscript}
                      prefersReducedMotion={prefersReducedMotion}
                    />
                  ) : null}

                </div>
              ) : (
                <p className="flex min-h-24 items-center justify-center text-center text-[13px] text-muted-foreground/55">
                  Your words will appear here.
                </p>
              )}
            </div>
          </div>

          {/* Error */}
          <AnimatePresence initial={false}>
            {errorMessage ? (
              <motion.p
                key="voice-error"
                role="alert"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className="mt-6 flex w-full items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                {errorMessage}
              </motion.p>
            ) : null}
          </AnimatePresence>

          {/*
            Footnote — kept quiet, but now TRUE.

            The old text ended "Nothing is saved to your account", which was
            only accidentally right: the tables existed but nothing wrote to
            them. Now conversation text IS saved when history is on, so the copy
            has to say what is stored (text only), what is not (audio, never),
            and who else touches the data (the STT provider and the hosted
            models). A privacy note that understates what happens is worse than
            no note at all.
          */}
          <p className="mt-7 text-center text-[11px] leading-relaxed text-muted-foreground/55">
            Your audio is never stored — it goes to a streaming speech-to-text
            service for transcription, and some languages use your
            browser&apos;s built-in recognition instead. Replies come from hosted
            AI models. {memoryEnabled
              ? "If you turn on conversation history, the text of this conversation is saved to your account."
              : "Conversation history is off, so nothing from this conversation is saved."}{" "}
            You can change this any time in{" "}
            <Link
              href="/settings"
              className="underline underline-offset-2 transition-colors hover:text-foreground/80"
            >
              Settings
            </Link>
            .
          </p>

          {languageNotice ? (
            <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
              {languageNotice}
            </p>
          ) : null}

          {!ttsUnsupported && !voiceAvailable ? (
            <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
              {getVoiceLanguage(language).englishLabel} text is ready, but this
              device has no {getVoiceLanguage(language).englishLabel} voice
              installed - the reply is in the transcript.
            </p>
          ) : null}

          {ttsUnsupported ? (
            <p className="mt-2 text-center text-[11px] text-red-500 dark:text-red-400">
              This browser has no speech synthesis — try Chrome, Edge, or
              Safari.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
