"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssemblyAiStream } from "@/lib/voice/assemblyai-stream";
import { BrowserSpeechStt } from "@/lib/voice/browser-stt";
import {
  DEFAULT_VOICE_LANGUAGE,
  getStreamingModel,
  getVoiceLanguage,
  sttEngineFor,
} from "@/lib/voice/languages";
import {
  containsBanglaScript,
  detectEmotionHint,
  detectTurnLanguage,
  explicitLanguageRequest,
  resolveLockedLanguage,
  scriptEvidenceLanguage,
  shouldEscalateToBangla,
  wantsEnglishOnly,
} from "@/lib/voice/language-lock";
import { PcmRecorder } from "@/lib/voice/pcm-recorder";
import { speak, stopSpeaking } from "@/lib/voice/speech";
import { requestBrainReply } from "@/lib/brain/brain-client";
import { isCannedReply } from "@/lib/brain/types";
import type { BrainTurn } from "@/lib/brain/types";
import { isVoiceLanguageCode } from "@/lib/voice/types";
import type {
  TranscriptTurn,
  VoiceLanguageCode,
  VoiceStatus,
} from "@/lib/voice/types";

/**
 * Orchestrates the voice loop:
 *
 *   idle → connecting → listening → thinking → speaking → listening → …
 *
 * The loop resumes Listening after every reply — no tap needed for the next
 * turn. Ten seconds of silence while Listening settles it back to Idle, and
 * the person taps the orb to begin again.
 *
 * Responsibilities are deliberately narrow: own the status machine and wire the
 * recorder, the STT socket, the Main Brain, and TTS together. All four
 * collaborators are plain classes/functions, so the UI stays declarative and
 * the pieces stay testable.
 *
 * Privacy: no audio is accumulated. Chunks go from the microphone straight into
 * the WebSocket; only finalized text is ever held in state.
 */

/**
 * How long `listening` may go without new speech activity before the session
 * settles back to Idle on its own. Every partial transcription restarts the
 * window, so this only ever fires on genuine silence — tap the orb to begin
 * again.
 */
const SILENCE_TIMEOUT_MS = 10_000;

export interface UseVoiceSessionResult {
  status: VoiceStatus;
  /** Set only while `status === "error"`. */
  errorMessage: string | null;
  /** Finalized turns, oldest first. */
  turns: TranscriptTurn[];
  /** Live, still-revising transcript for the current utterance. */
  partialTranscript: string;
  /** The language Elara is listening for and replying in. Read-only: it is
   *  locked per turn — from the speech itself, or from an explicit request
   *  like "reply in Spanish" — and matched automatically, never chosen. */
  language: VoiceLanguageCode;
  /** One honest line when this device cannot serve the detected language. */
  languageNotice: string | null;
  /** True between `start()` succeeding and `stop()`. */
  isActive: boolean;
  start: () => Promise<void>;
  stop: () => void;
  clearTranscript: () => void;
}

/** Shape returned by `/api/voice/token`. */
interface TokenPayload {
  token?: string;
  expiresInSeconds?: number;
  error?: string;
}

/** Which recognizer is driving the live session. */
type SttEngine = "assemblyai" | "browser";

/**
 * Shown once when this browser cannot transcribe the locked language.
 *
 * Quiet and actionable, and never a red failure box: the session keeps working
 * in English, and the other language's replies stay available as text. Named
 * after the language it is about, because the browser recognizer is now the
 * route for every language AssemblyAI cannot serve — not only Bengali.
 */
function browserUnavailableNotice(code: VoiceLanguageCode): string {
  return (
    `${getVoiceLanguage(code).englishLabel} speech is not available in this ` +
    "browser - Chrome or Edge can do it. I will keep listening in English."
  );
}

/**
 * Map a stream-reported `language_code` onto the accepted lock set, or `null`.
 *
 * Reports arrive as BCP-47-ish tags ("es", "pt-BR", "zh-CN"): only the primary
 * subtag matters here, and anything outside the accepted set — a language Elara
 * has no recognizer or voice path for — is discarded rather than guessed at.
 */
function acceptedReportedLanguage(
  reported: string | null | undefined
): VoiceLanguageCode | null {
  if (!reported) {
    return null;
  }

  const primary = reported.toLowerCase().split("-")[0];

  return isVoiceLanguageCode(primary) ? primary : null;
}

export function useVoiceSession(): UseVoiceSessionResult {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [language, setLanguageState] =
    useState<VoiceLanguageCode>(DEFAULT_VOICE_LANGUAGE);
  const [languageNotice, setLanguageNotice] = useState<string | null>(null);

  const recorderRef = useRef<PcmRecorder | null>(null);
  const streamRef = useRef<AssemblyAiStream | null>(null);
  /** Browser STT path (Bangla today) — mutually exclusive with `streamRef`. */
  const browserSttRef = useRef<BrowserSpeechStt | null>(null);

  /**
   * Mirrors of mutable state for use inside WebSocket callbacks, which would
   * otherwise capture stale values from the render they were created in.
   */
  const statusRef = useRef<VoiceStatus>("idle");
  const activeRef = useRef(false);
  const languageRef = useRef<VoiceLanguageCode>(DEFAULT_VOICE_LANGUAGE);

  /**
   * A1 HARD ENGLISH LOCK.
   *
   * Set the moment the person says "stick to English" (or equivalent). While it
   * holds, the reply language is pinned to `en` and the Bangla engine
   * escalation is suppressed, so nothing can pull the conversation out of
   * English against an explicit instruction. The only thing that releases it is
   * unambiguous Bangla script — the clearest possible "switch".
   */
  const englishOnlyRef = useRef(false);
  /**
   * The recognizer actually driving the session.
   *
   * Deliberately SEPARATE from the reply language. There is no real-time
   * Bengali model on the STT side, so Bangla audio can only be recognised by
   * the browser's own engine - a different microphone pipeline that has to be
   * opened on purpose. Keeping the two apart means a language decision can
   * never silently move the microphone, and an engine decision can never
   * silently change the reply language.
   */
  const engineRef = useRef<SttEngine>("assemblyai");
  /**
   * The language the browser recognizer is currently listening for.
   *
   * The browser path is language-generic (Bangla and Catalan today), so the tag
   * it opens with has to travel with the lock instead of being hardcoded.
   */
  const browserLanguageRef = useRef<VoiceLanguageCode>("bn");
  /** Set when this browser cannot run the fallback recognizer, so we stop trying. */
  const browserSttUnavailableRef = useRef(false);
  /**
   * U4 — the language the person EXPLICITLY asked for ("reply in Spanish").
   *
   * Held across turns like the A1 English lock, because an instruction outlives
   * the sentence that carried it: a follow-up of three words is not evidence
   * enough to move the lock, but the instruction still stands. Cleared by a new
   * instruction, by real Bangla script, or at the start of a new session.
   */
  const pinnedLanguageRef = useRef<VoiceLanguageCode | null>(null);
  /**
   * The current finalized-turn handler. Held in a ref so the recognizer
   * helpers can be declared BEFORE `handleFinalTurn` without a circular
   * dependency between them.
   */
  const finalHandlerRef = useRef<(text: string, languageCode?: string) => void>(
    () => undefined
  );
  const turnCounterRef = useRef(0);
  /**
   * SESSION EPOCH — the guard against a recognizer from a previous session.
   *
   * Bumped by `start()` and by `stop()`, and captured by whichever recognizer
   * is opened next. Every recognizer callback is checked against the CURRENT
   * epoch before it can become a turn or a partial, so a result that arrives
   * after the session was torn down — or a buffered final that a reopened
   * microphone flushes on its first frame — is dropped instead of being
   * replayed as a phantom turn or a duplicate reply.
   */
  const epochRef = useRef(0);
  /**
   * Mirror of the finalized turns, so the brain always receives full context
   * without reading state that may be stale inside async callbacks.
   */
  const turnsRef = useRef<TranscriptTurn[]>([]);

  const setStatusSafe = useCallback((next: VoiceStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const nextTurnId = useCallback(() => {
    turnCounterRef.current += 1;
    return `turn-${turnCounterRef.current}`;
  }, []);

  const fail = useCallback(
    (message: string) => {
      activeRef.current = false;
      browserSttRef.current?.stop();
      browserSttRef.current = null;
      streamRef.current?.terminate();
      streamRef.current = null;
      recorderRef.current?.stop();
      recorderRef.current = null;
      stopSpeaking();
      setErrorMessage(message);
      setStatusSafe("error");
      setPartialTranscript("");
    },
    [setStatusSafe]
  );

  /** Fully tears the session down and returns to Idle. Idempotent. */
  const stop = useCallback(() => {
    activeRef.current = false;

    /*
     * Retire the recognizer's callbacks BEFORE tearing it down. A closed socket
     * or a stopped Web Speech instance can still deliver one last final, and a
     * finalized utterance arriving after the session ended is exactly the
     * "old buffer became the next turn" report — the epoch check drops it.
     */
    epochRef.current += 1;

    stopSpeaking();

    browserSttRef.current?.stop();
    browserSttRef.current = null;

    streamRef.current?.terminate();
    streamRef.current = null;

    recorderRef.current?.stop();
    recorderRef.current = null;

    setPartialTranscript("");
    setErrorMessage(null);
    setStatusSafe("idle");
  }, [setStatusSafe]);

  // Never leave the microphone or socket running after unmount.
  useEffect(() => stop, [stop]);

  /**
   * SILENCE TIMEOUT — the microphone never stays open on its own.
   *
   * Ten seconds in `listening` with no new speech activity stops the session
   * back to Idle: recognizer, recorder and partial buffer all close, and the
   * orb is tap-to-talk again. Real activity re-arms the window — every partial
   * transcription restarts the ten seconds — so nobody is cut off
   * mid-sentence. Elara's own audio cannot re-arm it: nothing from the
   * microphone produces partials while she is thinking or speaking (the echo
   * gate), so the timer only ever measures the person's own silence.
   */
  useEffect(() => {
    if (status !== "listening") {
      return;
    }

    const timer = setTimeout(() => {
      if (statusRef.current === "listening") {
        stop();
      }
    }, SILENCE_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [status, partialTranscript, stop]);

  /**
   * Text callbacks shared by both recognizers.
   *
   * The echo gate lives here: while Elara is thinking or speaking, nothing from
   * the microphone becomes a turn. The error handler is injected so the Bangla
   * escalation can absorb a failure of the alternative engine instead of
   * turning a working conversation into a red error box.
   */
  const buildCallbacks = useCallback(
    (onError: (message: string) => void, epoch: number) => ({
      onPartial: (partial: string) => {
        // Stale-recognizer guard: a partial from a session that has already been
        // stopped (or replaced) must not repopulate the buffer the person is
        // reading — and must not re-arm the silence timer with dead air.
        if (epochRef.current !== epoch) {
          return;
        }

        if (statusRef.current === "listening") {
          setPartialTranscript(partial);
        }
      },
      onFinal: (text: string, languageCode?: string) => {
        // Same guard for a finalized utterance: the buffer of the previous
        // session is never spoken as the next turn.
        if (epochRef.current !== epoch) {
          return;
        }

        finalHandlerRef.current(text, languageCode);
      },
      onError,
    }),
    []
  );

  /** Tears down whichever recognizer is live, leaving the session active. */
  const closeRecognizer = useCallback(() => {
    browserSttRef.current?.stop();
    browserSttRef.current = null;

    streamRef.current?.terminate();
    streamRef.current = null;

    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  /**
   * Opens the browser's own recognizer for a locked language.
   *
   * Web Speech owns the microphone directly: no streaming token, no PCM
   * recorder, no audio held on this side - only text callbacks. The tag comes
   * from the language definition, so this path serves every language AssemblyAI
   * has no real-time model for (Bangla today, Catalan likewise).
   */
  const openBrowserRecognizer = useCallback(
    async (code: VoiceLanguageCode, onError: (message: string) => void) => {
      const { ttsLang } = getVoiceLanguage(code);
      const browserStt = new BrowserSpeechStt();
      browserSttRef.current = browserStt;

      // The epoch this recognizer belongs to: any callback it delivers after the
      // session moves on is ignored.
      const epoch = epochRef.current;

      await browserStt.start({
        lang: ttsLang,
        callbacks: buildCallbacks(onError, epoch),
      });
    },
    [buildCallbacks]
  );

  /**
   * Opens the AssemblyAI stream on the microphone's PCM.
   *
   * No language is sent: the streaming model detects and code-switches across
   * the languages it serves, which is what makes language selection automatic
   * for everyone - and keeps Bangla from being forced through a model that
   * cannot represent it.
   */
  const openAssemblyAi = useCallback(
    async (onError: (message: string) => void) => {
      /*
       * Captured BEFORE the token round trip, not after: a stop that lands
       * mid-fetch must make this whole open stale, and a recognizer whose epoch
       * is already retired is never opened at all (the guard after the fetch).
       */
      const epoch = epochRef.current;

      const response = await fetch("/api/voice/token", { cache: "no-store" });
      const payload = (await response.json()) as TokenPayload;

      if (!response.ok || !payload.token) {
        throw new Error(
          payload.error ?? "Could not start a voice session. Please try again."
        );
      }

      // The session moved on while the token was in flight: open nothing. The
      // caller's own `activeRef` check decides what happens next, so no error is
      // raised and no orphaned (billable) socket is left behind.
      if (epochRef.current !== epoch) {
        return;
      }

      const recorder = new PcmRecorder({
        onChunk: (chunk) => {
          const current = statusRef.current;
          // Never transcribe Elara's own voice back to herself, and drop audio
          // captured before the socket is ready ("connecting").
          if (
            current === "speaking" ||
            current === "thinking" ||
            current === "connecting"
          ) {
            return;
          }
          streamRef.current?.sendAudio(chunk);
        },
      });

      const sampleRate = await recorder.start();
      recorderRef.current = recorder;

      const stream = new AssemblyAiStream();
      streamRef.current = stream;

      const speechModel = getStreamingModel(DEFAULT_VOICE_LANGUAGE);

      if (speechModel === null) {
        throw new Error("Could not open the voice model. Please try again.");
      }

      await stream.connect({
        token: payload.token,
        sampleRate,
        speechModel,
        callbacks: buildCallbacks(onError, epoch),
      });
    },
    [buildCallbacks]
  );

  /**
   * Swaps the recognizer without dropping the conversation.
   *
   * Failure is contained: if the other engine will not open, the previous one is
   * restored and the person gets one honest line instead of a dead session.
   * Nothing here is user-initiated - it is all a consequence of what was said.
   */
  const switchEngine = useCallback(
    async (next: SttEngine) => {
      /*
       * Already on the streaming engine: nothing to swap. The browser path is
       * re-opened even when the engine name matches, because the locked language
       * can change WITHIN it (Bangla → Catalan) — the tag has to follow.
       */
      if (next === "assemblyai" && engineRef.current === "assemblyai") {
        return;
      }

      // Retire the old recognizer's callbacks BEFORE it is torn down, so the
      // window where a late final could still match is closed; the replacement
      // captures the new epoch when it opens.
      epochRef.current += 1;
      closeRecognizer();
      engineRef.current = next;

      if (next === "assemblyai") {
        try {
          await openAssemblyAi(fail);
        } catch {
          // start() reports genuine failures; a swap is best-effort.
        }
        return;
      }

      /*
       * Opening the browser's recognizer. A post-ready failure (the browser
       * refusing the language tag) is absorbed here rather than surfaced: the
       * text still works, so a red error box would overstate how broken it is.
       */
      const onBrowserFailure = () => {
        browserSttUnavailableRef.current = true;
        setLanguageNotice(browserUnavailableNotice(browserLanguageRef.current));

        browserSttRef.current?.stop();
        browserSttRef.current = null;
        engineRef.current = "assemblyai";

        void openAssemblyAi(fail).catch(() => undefined);
      };

      try {
        await openBrowserRecognizer(browserLanguageRef.current, onBrowserFailure);
      } catch {
        onBrowserFailure();
      }
    },
    [closeRecognizer, fail, openAssemblyAi, openBrowserRecognizer]
  );

  /**
   * A finalized utterance is the trigger for the whole reply half of the loop:
   * transcript → Main Brain → speech → back to listening.
   */
  const handleFinalTurn = useCallback(
    (text: string, reportedLanguage?: string) => {
      /*
       * ECHO GATE — STRICT: a final transcript only counts while the session
       * is LISTENING.
       *
       * The AssemblyAI path drops audio frames while Elara is thinking or
       * speaking; the browser path can only drop transcripts at this
       * boundary. Either way her own voice must never come back as a "user"
       * turn. Idle and Error are excluded as well: a recognizer flushing one
       * last result on the way down must not become a phantom turn, so the
       * next session opens with no garbage input.
       *
       * The epoch check in `buildCallbacks` already drops the callbacks of a
       * retired recognizer; this pair is the second lock on the same door —
       * a session that has been stopped cannot accept a turn even if a
       * callback somehow got through.
       */
      if (statusRef.current !== "listening" || !activeRef.current) {
        return;
      }

      setPartialTranscript("");

      /*
       * AUTO LANGUAGE - detected, matched, never asked for.
       *
       * There is no language picker: the turn itself is the evidence. Bangla
       * script, or TWO distinct Banglish markers, is Bangla; real English
       * function words are English; anything uncertain - a bare city name like
       * "Dhaka" after a question - HOLDS the previous answer instead of
       * guessing. That hold is what stops an English conversation from sliding
       * into Bangla just because a place was named.
       *
       * The reply language drives the brain's language directive AND the TTS
       * voice for this whole turn, so Bangla in means Bangla out.
       */
      /*
       * A1 — HARD ENGLISH LOCK.
       *
       * Detection above is a heuristic; a direct instruction is not. "Stick to
       * English" pins this turn AND the session to English, so a later romanised
       * word can never drag the conversation back. Real Bangla script is the only
       * thing that releases it, because that is the only unambiguous switch.
       */
      if (wantsEnglishOnly(text)) {
        englishOnlyRef.current = true;
        pinnedLanguageRef.current = null;
      } else if (englishOnlyRef.current && containsBanglaScript(text)) {
        englishOnlyRef.current = false;
      }

      /*
       * U4 — AN EXPLICIT LANGUAGE REQUEST.
       *
       * "Reply in Spanish" is an instruction, not an inference, so it PINS the
       * session: badge, brain directive and TTS voice all follow it — including
       * for the Latin-script languages no script check can tell apart. A new
       * instruction replaces it; certain script evidence (real Bangla, kana,
       * Devanagari …) breaks it the same way it breaks the English hold, because
       * the person plainly switched.
       */
      const requested = explicitLanguageRequest(text);

      if (requested !== null) {
        pinnedLanguageRef.current = requested;
        englishOnlyRef.current = false;
      }

      /*
       * U4(b) — WHAT THE STREAM HEARD, the weakest evidence there is.
       *
       * With `language_detection` on the socket, a finalized turn can carry the
       * language AssemblyAI believes was spoken. It is consulted only when
       * nothing above decided the turn — exactly the Latin-script gap ("hola",
       * "guten Tag") that no instruction, script, or English marker can
       * resolve. A pin or script evidence always outranks it; an unknown code
       * is dropped against the accepted set rather than trusted; and when the
       * report is silent (browser engine, unsupported model), the lock behaves
       * exactly as before.
       */
      const detectedLanguage =
        detectTurnLanguage(text) ?? acceptedReportedLanguage(reportedLanguage);
      const scriptEvidence =
        requested === null ? scriptEvidenceLanguage(text) : null;

      if (
        pinnedLanguageRef.current !== null &&
        scriptEvidence !== null &&
        scriptEvidence !== pinnedLanguageRef.current
      ) {
        pinnedLanguageRef.current = null;
      }

      const banglaTurn = !englishOnlyRef.current && shouldEscalateToBangla(text);
      const lockedLanguage = englishOnlyRef.current
        ? "en"
        : (pinnedLanguageRef.current ??
          (banglaTurn
            ? "bn"
            : resolveLockedLanguage(languageRef.current, detectedLanguage)));

      if (lockedLanguage !== languageRef.current) {
        languageRef.current = lockedLanguage;
        setLanguageState(lockedLanguage);
      }

      /*
       * THE MICROPHONE FOLLOWS THE LOCK.
       *
       * Every language AssemblyAI has a real-time model for keeps the streaming
       * engine; a language it cannot serve is recognised by the browser's own
       * recognizer — opened in the background, silently, and only once. A browser
       * that cannot do it keeps the engine it has and says so honestly, once.
       */
      const browserSttNeeded =
        sttEngineFor(lockedLanguage) === "browser" &&
        !browserSttUnavailableRef.current;

      if (browserSttNeeded) {
        browserLanguageRef.current = lockedLanguage;

        if (engineRef.current !== "browser") {
          void switchEngine("browser");
        }
      } else if (engineRef.current === "browser") {
        // The lock moved back to a language AssemblyAI serves — release the mic
        // to the streaming engine instead of leaving it on the fallback.
        void switchEngine("assemblyai");
      }

      const userTurn: TranscriptTurn = {
        id: nextTurnId(),
        speaker: "you",
        text,
        isFinal: true,
      };
      const history = turnsRef.current;
      turnsRef.current = [...history, userTurn];
      setTurns(turnsRef.current);

      const replyLanguage = lockedLanguage;
      const { ttsLang } = getVoiceLanguage(replyLanguage);
      const emotion = detectEmotionHint(text);

      setStatusSafe("thinking");

      void (async () => {
        /*
         * Recent context (excluding the turn just finalized) for the brain.
         *
         * Canned lines — fallbacks and refusals — are dropped here AND on the
         * server: a refusal replayed as one of Elara's own turns teaches the
         * model to refuse ordinary small talk, which is the exact loop we are
         * closing. The server filter is the authoritative one; this keeps the
         * poisoned text off the wire in the first place.
         */
        const brainHistory: BrainTurn[] = history
          .filter((turn) => !isCannedReply(turn.text))
          .slice(-8)
          .map((turn) => ({ speaker: turn.speaker, text: turn.text }));

        const result = await requestBrainReply(
          text,
          brainHistory,
          replyLanguage,
          emotion
        );

        if (!activeRef.current) {
          return;
        }

        const elaraTurn: TranscriptTurn = {
          id: nextTurnId(),
          speaker: "elara",
          text: result.reply,
          isFinal: true,
        };
        turnsRef.current = [...turnsRef.current, elaraTurn];
        setTurns(turnsRef.current);
        setStatusSafe("speaking");

        await speak({ text: result.reply, lang: ttsLang, emotion });

        // Resume listening so the person can speak the next turn without
        // tapping the orb again. The 10s silence timeout settles the session
        // to Idle if nobody speaks. (If they already tapped Stop while Elara
        // was talking, there is nothing to do.)
        if (activeRef.current) {
          setStatusSafe("listening");
        }
      })();
    },
    [nextTurnId, setStatusSafe, switchEngine]
  );

  // Keep the recognizer helpers pointed at the current finalized-turn handler.
  useEffect(() => {
    finalHandlerRef.current = handleFinalTurn;
  }, [handleFinalTurn]);

  /**
   * Requests the mic, mints a token, and opens the STT socket.
   *
   * Order matters: the microphone prompt happens before the socket is opened,
   * so a denied permission never leaves an orphaned (billable) session.
   */
  const start = useCallback(async () => {
    if (activeRef.current) {
      return;
    }

    setErrorMessage(null);
    setLanguageNotice(null);
    setPartialTranscript("");
    // A fresh epoch: nothing a previous recognizer still emits can reach this
    // session as a partial, a turn or a repeated reply.
    epochRef.current += 1;
    // A new session starts with no language pinned — the lock rebuilds per turn.
    englishOnlyRef.current = false;
    pinnedLanguageRef.current = null;
    activeRef.current = true;
    // Surface the handshake (permission prompt + token + socket open) in the
    // machine itself, so the UI never shows a silent gap while starting.
    setStatusSafe("connecting");

    try {
      /*
       * One engine at a time, chosen automatically.
       *
       * The streaming model is the mother for every language it can serve, and
       * it detects and switches across them with no user action - which is the
       * whole point: nobody should ever be asked to pick a language. A language
       * it cannot serve is the single exception: the silent escalation in
       * handleFinalTurn opens the browser recognizer for it, in that language.
       */
      if (engineRef.current === "browser") {
        await openBrowserRecognizer(browserLanguageRef.current, fail);
      } else {
        await openAssemblyAi(fail);
      }

      // The user may have hit Stop while we were connecting.
      if (!activeRef.current) {
        stop();
        return;
      }

      setStatusSafe("listening");
    } catch (error) {
      // A socket failure has already reported something specific via `onError`
      // (e.g. "token may have expired"). Don't overwrite it with a generic
      // "closed before ready" message.
      if (statusRef.current !== "error") {
        fail(
          error instanceof Error
            ? error.message
            : "Could not start the voice session."
        );
      }
    }
  }, [fail, openAssemblyAi, openBrowserRecognizer, setStatusSafe, stop]);

  /*
   * There is deliberately no `setLanguage`. Language is detected from the turn
   * and matched automatically - the way a person switches language with a
   * friend - so there is no control to get wrong and nothing to ask the user.
   */

  const clearTranscript = useCallback(() => {
    turnsRef.current = [];
    setTurns([]);
    setPartialTranscript("");
  }, []);

  /** True from `start()` until `stop()` — including the connecting handshake,
   *  so the orb presents its stop affordance the moment a session begins. */
  const isActive =
    status === "connecting" ||
    status === "listening" ||
    status === "thinking" ||
    status === "speaking";

  return {
    status,
    errorMessage,
    turns,
    partialTranscript,
    language,
    languageNotice,
    isActive,
    start,
    stop,
    clearTranscript,
  };
}