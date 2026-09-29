"use client";

/**
 * Browser Web Speech recognizer — the STT FALLBACK path.
 *
 * WHY THIS EXISTS
 *
 * AssemblyAI's real-time (streaming) models do not support Bengali: verified
 * against the live docs (2026-09), Universal-3.5 Pro Streaming covers 18
 * languages and Universal-Streaming Multilingual covers six — Bengali is in
 * neither, and `language_code` applies to pre-recorded audio only. A Bangla
 * utterance sent to a multilingual streaming model therefore comes back mapped
 * onto whichever of its own languages fits the phonetics best, which is exactly
 * how Bangla turned into Italian-looking text.
 *
 * The locked Voice Brain already names this layer: "Fallback → Browser Web
 * Speech API". So when the locked language has no AssemblyAI real-time model,
 * this is the honest route that actually works for the Bangla demo instead of
 * claiming a capability AssemblyAI does not have.
 *
 * TRADE-OFF, STATED PLAINLY: Chrome and Safari run this recognizer through
 * their own cloud service, so that audio is handled by the browser vendor.
 * Elara stores and logs nothing, and this path is only used for languages
 * AssemblyAI cannot serve — everything it can serve stays on AssemblyAI.
 *
 * Audio is never captured, buffered, or retained here: the browser owns the mic
 * and only text callbacks come back out.
 */

/* ──────────────────────────────────────────────────────────────────────────
   Minimal structural types for the Web Speech recognizer.

   `lib.dom.d.ts` still does not ship these, so they are declared locally.
   Only the members actually used are declared.
   ────────────────────────────────────────────────────────────────────────── */

interface BrowserSpeechAlternative {
  transcript: string;
}

interface BrowserSpeechResult {
  isFinal: boolean;
  [index: number]: BrowserSpeechAlternative;
}

interface BrowserSpeechResultList {
  readonly length: number;
  [index: number]: BrowserSpeechResult;
}

interface BrowserSpeechResultEvent {
  resultIndex: number;
  results: BrowserSpeechResultList;
}

interface BrowserSpeechErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechResultEvent) => void) | null;
  onerror: ((event: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getRecognitionCtor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const scope = window as unknown as {
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
  };

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Whether this browser can run the fallback recognizer at all. */
export function isBrowserSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export interface BrowserSttCallbacks {
  /** Equivalent of AssemblyAI's `Begin` — the session is live. */
  onReady?: () => void;
  /** Still-revising text for the current utterance. */
  onPartial: (text: string) => void;
  /** A finalized utterance — safe to hand to the brain. */
  onFinal: (text: string) => void;
  /** Human-readable, TERMINAL failure. */
  onError: (message: string) => void;
}

export interface BrowserSttOptions {
  /** BCP-47 tag, e.g. `bn-BD`. */
  lang: string;
  callbacks: BrowserSttCallbacks;
}

/** Map a Web Speech error code to something a person can act on. */
function describeRecognitionError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission was denied. Allow it in your browser and try again.";
    case "audio-capture":
      return "No microphone was found. Connect one and try again.";
    case "network":
      return "The browser speech service is unreachable. Check your network and try again.";
    case "language-not-supported":
      return "This browser cannot recognise that language. Try English instead.";
    default:
      return "Speech recognition stopped unexpectedly. Please try again.";
  }
}

/**
 * Errors that mean "nothing was said", not "this is broken".
 *
 * `no-speech` and `aborted` fire constantly in normal use — a pause, a restart,
 * an intentional stop. Treating them as terminal would end a healthy session.
 */
const NON_TERMINAL_ERRORS = new Set(["no-speech", "aborted"]);


/** Delay before re-arming after the recognizer ends on its own. */
const RESTART_DELAY_MS = 250;

export class BrowserSpeechStt {
  private recognition: BrowserSpeechRecognition | null = null;
  private callbacks: BrowserSttCallbacks | null = null;
  private lang = "en-US";
  /** True while the session should stay live, including restarts. */
  private active = false;
  /** Set when we stop deliberately, so `onend` never restarts. */
  private closingIntentionally = false;
  private restartTimer: number | null = null;
  /** Lowercased text of the last final, to drop duplicate finals. */
  private lastFinalText = "";
  private reportedReady = false;

  /** Opens the recognizer. Rejects only when it cannot be started at all. */
  start(options: BrowserSttOptions): Promise<void> {
    const Ctor = getRecognitionCtor();

    if (!Ctor) {
      const message =
        "This browser has no built-in speech recognition. Try Chrome, Edge, or Safari.";
      options.callbacks.onError(message);
      return Promise.reject(new Error(message));
    }

    this.callbacks = options.callbacks;
    this.lang = options.lang;
    this.active = true;
    this.closingIntentionally = false;
    this.lastFinalText = "";
    this.reportedReady = false;

    return new Promise<void>((resolve, reject) => {
      let recognition: BrowserSpeechRecognition;

      try {
        recognition = new Ctor();
      } catch {
        const message = "Could not start the browser recognizer.";
        options.callbacks.onError(message);
        reject(new Error(message));
        return;
      }

      recognition.lang = this.lang;
      recognition.continuous = true;
      // Partials are required: the UI shows a live transcript, and the loop
      // needs the same streaming feel the AssemblyAI path provides.
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this.reportedReady = true;
        this.callbacks?.onReady?.();
        resolve();
      };

      recognition.onresult = (event) => this.handleResult(event);
      recognition.onerror = (event) => this.handleError(event, reject);
      recognition.onend = () => this.handleEnd();

      this.recognition = recognition;

      try {
        recognition.start();
      } catch {
        // Chrome throws `InvalidStateError` if start() is called twice before
        // the previous session ends. Treat that as "already running".
        this.reportedReady = true;
        resolve();
      }
    });
  }

  private handleResult(event: BrowserSpeechResultEvent): void {
    const callbacks = this.callbacks;

    if (!callbacks) {
      return;
    }

    let interim = "";
    let final = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = (result[0]?.transcript ?? "").trim();

      if (text.length === 0) {
        continue;
      }

      if (result.isFinal) {
        final += `${text} `;
      } else {
        interim += `${text} `;
      }
    }

    if (final.trim().length > 0) {
      const trimmed = final.trim();

      // Same dedupe rule as the AssemblyAI stream: a repeated final must not
      // trigger a second brain call for one utterance.
      if (trimmed.toLowerCase() !== this.lastFinalText) {
        this.lastFinalText = trimmed.toLowerCase();
        callbacks.onFinal(trimmed);
      }
    } else if (interim.trim().length > 0) {
      callbacks.onPartial(interim.trim());
    }
  }

  private handleError(
    event: BrowserSpeechErrorEvent,
    reject: (error: Error) => void,
  ): void {
    const code = event.error;

    // Silence and intentional aborts are part of normal operation.
    if (NON_TERMINAL_ERRORS.has(code)) {
      return;
    }

    const message = describeRecognitionError(code);

    this.active = false;
    this.clearRestartTimer();

    // A failure after the session was live is reported once, terminally.
    if (this.reportedReady) {
      this.callbacks?.onError(message);
    }

    reject(new Error(message));
  }

  /**
   * The browser recognizer ends on its own after a pause (and after long
   * silence on some platforms), so a live session re-arms itself — the fallback
   * equivalent of the AssemblyAI stream's reconnect behaviour.
   */
  private handleEnd(): void {
    if (!this.active || this.closingIntentionally) {
      return;
    }

    this.clearRestartTimer();
    this.restartTimer = window.setTimeout(() => {
      if (!this.active || !this.recognition) {
        return;
      }

      try {
        this.recognition.start();
      } catch {
        // Already running — nothing to do.
      }
    }, RESTART_DELAY_MS);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  /** True while a session should be live. */
  get isActive(): boolean {
    return this.active;
  }

  /** Idempotent teardown. Releases the mic; keeps nothing. */
  stop(): void {
    this.active = false;
    this.closingIntentionally = true;
    this.clearRestartTimer();

    const recognition = this.recognition;

    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;

      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
    }

    this.recognition = null;
    this.callbacks = null;
    this.lastFinalText = "";
    this.reportedReady = false;
  }
}
