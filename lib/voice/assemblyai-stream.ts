"use client";

import type { AssemblyAiServerMessage } from "@/lib/voice/types";
import { sttConfigurationMessage } from "@/lib/voice/keyterms";

/**
 * Thin, typed client for the AssemblyAI v3 real-time WebSocket.
 *
 * Auth: the browser receives a single-use, short-lived token from
 * `/api/voice/token` and passes it as the `token` query parameter (the
 * documented browser flow — the WebSocket API cannot send custom headers).
 * The long-lived `ASSEMBLYAI_API_KEY` never reaches the client.
 *
 * Audio is forwarded straight to the socket and never retained. Nothing here
 * writes audio or transcripts to storage, console, or the network besides the
 * AssemblyAI socket itself.
 */

const STREAMING_WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
const PCM_ENCODING = "pcm_s16le";
/**
 * BOUNDED HANDSHAKE — how long the socket may take to confirm the session.
 *
 * The open + `Begin` round trip is normally well under a second, but a hung
 * handshake used to leave the UI on "connecting" indefinitely, with a manual
 * Stop as the only way out. Eight seconds is generous for a slow mobile
 * connection and still bounded.
 */
const CONNECT_TIMEOUT_MS = 8000;
/**
 * Below this, a reported `language_code` is not treated as evidence.
 *
 * The report is an inference about what was said, so a shaky one must never
 * move the language lock on its own — instructions and script evidence are
 * checked first regardless (see `handleFinalTurn`).
 */
const MIN_REPORTED_LANGUAGE_CONFIDENCE = 0.6;

export interface AssemblyAiStreamCallbacks {
  /** Socket is open and AssemblyAI acknowledged the session. */
  onReady?: () => void;
  /** A turn that is still being revised — render as a live partial. */
  onPartial: (text: string) => void;
  /** A finalized turn — safe to hand to the brain. The second argument is the
   *  language the stream REPORTED for the turn, when it reports one. */
  onFinal: (text: string, languageCode?: string) => void;
  /** Human-readable failure. Always terminal for this stream. */
  onError: (message: string) => void;
  /** Session closed (either side). Not necessarily an error. */
  onClose?: () => void;
}

export interface ConnectOptions {
  token: string;
  /** Actual AudioContext rate — must match what we send as PCM. */
  sampleRate: number;
  /** AssemblyAI streaming model id, resolved from the language lock. */
  speechModel: string;
  callbacks: AssemblyAiStreamCallbacks;
  /** Override for the bounded handshake (defaults to CONNECT_TIMEOUT_MS). */
  timeoutMs?: number;
}

/** Map a close code to something a user can act on. */
function describeCloseCode(code: number): string {
  switch (code) {
    case 1000:
      return "Voice session ended.";
    case 1006:
      return "Lost connection to AssemblyAI. Check your network and try again.";
    case 1008:
      return "AssemblyAI rejected the session. The access token may have expired.";
    case 1011:
      return "AssemblyAI hit an internal error. Please try again.";
    case 3005:
      return "Session timed out. Try starting a new conversation.";
    case 3006:
      return "Session was terminated by the server.";
    default:
      return `Voice session closed unexpectedly (code ${code}).`;
  }
}

export class AssemblyAiStream {
  private socket: WebSocket | null = null;
  private callbacks: AssemblyAiStreamCallbacks | null = null;
  /** Set when we close deliberately, so `onclose` stays silent. */
  private closingIntentionally = false;
  /** True once AssemblyAI has sent `Begin`. */
  private sessionReady = false;
  /** True once we've reported a terminal error, to avoid duplicates. */
  private failed = false;
  /** `turn_order` of the last finalized turn, for re-finalization dedupe. */
  private lastFinalTurnOrder: number | null = null;
  /** Lowercased text of the last finalized turn (fallback dedupe key). */
  private lastFinalText = "";

  /**
   * Opens the socket and resolves when AssemblyAI confirms the session.
   * Rejects if the connection fails before that point.
   */
  connect(options: ConnectOptions): Promise<void> {
    const { token, sampleRate, speechModel, callbacks } = options;
    const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;

    this.callbacks = callbacks;
    this.closingIntentionally = false;
    this.sessionReady = false;
    this.failed = false;
    this.lastFinalTurnOrder = null;
    this.lastFinalText = "";

    const params = new URLSearchParams({
      sample_rate: String(sampleRate),
      encoding: PCM_ENCODING,
      format_turns: "true",
      speech_model: speechModel,
      /*
       * U4 — ask each finalized Turn to report the language it heard.
       *
       * Reporting only: it does not change how the audio is transcribed. A
       * model that does not support it simply never populates the fields, and
       * the lock-side handling stays inert — so this can only add evidence,
       * never remove a working session.
       */
      language_detection: "true",
      token,
    });

    return new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      let timer: number | null = null;

      const clearTimer = () => {
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      };

      /*
       * Every settlement clears the handshake timer, so a session that opened
       * (or failed) on its own never gets a late "timed out" afterwards.
       */
      const settleResolve = () => {
        clearTimer();
        resolve();
      };

      const settleReject = (error: Error) => {
        clearTimer();
        reject(error);
      };

      try {
        socket = new WebSocket(`${STREAMING_WS_BASE}?${params.toString()}`);
      } catch {
        callbacks.onError("Could not open the voice connection.");
        reject(new Error("WebSocket construction failed"));
        return;
      }

      this.socket = socket;
      socket.binaryType = "arraybuffer";

      timer = window.setTimeout(() => {
        if (this.failed || this.sessionReady) {
          return;
        }

        this.failed = true;
        const message = "Voice connection timed out. Please try again.";
        callbacks.onError(message);

        try {
          socket.close();
        } catch {
          // Already gone — nothing left to close.
        }

        settleReject(new Error(message));
      }, timeoutMs);

      socket.onmessage = (event: MessageEvent<string>) => {
        this.handleMessage(event, settleResolve, settleReject);
      };

      socket.onerror = () => {
        if (this.failed) {
          return;
        }
        this.failed = true;
        const message = "Voice connection error. Please try again.";
        callbacks.onError(message);
        settleReject(new Error(message));
      };

      socket.onclose = (event: CloseEvent) => {
        clearTimer();
        this.socket = null;

        if (this.closingIntentionally) {
          /*
           * A deliberate Stop mid-handshake settles the promise as well. It used
           * to be left pending, so the `await` inside the caller never finished
           * and the half-open attempt stayed on the stack until GC.
           */
          settleResolve();
          callbacks.onClose?.();
          return;
        }

        if (!this.failed) {
          this.failed = true;
          callbacks.onError(describeCloseCode(event.code));
        }

        settleReject(new Error("Socket closed before the session was ready"));
      };
    });
  }

  private handleMessage(
    event: MessageEvent<string>,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    let message: AssemblyAiServerMessage;

    try {
      message = JSON.parse(String(event.data)) as AssemblyAiServerMessage;
    } catch {
      return; // Ignore frames we cannot parse rather than killing the session.
    }

    const callbacks = this.callbacks;
    if (!callbacks) {
      return;
    }

    switch (message.type) {
      case "Begin": {
        this.sessionReady = true;
        // Keyterm + context biasing, applied the moment the session is live.
        // This is what stops "Elara" being transcribed as "Ilara".
        this.applySpeechBiasing();
        callbacks.onReady?.();
        resolve();
        return;
      }

      case "Turn": {
        const turn = message as {
          transcript?: string;
          end_of_turn?: boolean;
          turn_order?: number;
          language_code?: string;
          language_confidence?: number;
        };
        const transcript = (turn.transcript ?? "").trim();

        if (transcript.length === 0) {
          return;
        }

        if (turn.end_of_turn) {
          /*
           * A finalized turn can arrive more than once: AssemblyAI re-emits the
           * same turn_order with a (usually identical) formatted transcript.
           * Forwarding both showed duplicate bubbles in the UI and triggered
           * two brain calls for one utterance — one of which then rendered as a
           * user turn with no reply beside it.
           *
           * THE OLD TEST WAS FRAGILE IN TWO WAYS. It compared against only the
           * single previous final, and it chose ONE strategy based on whether
           * that turn happened to carry a turn_order. A re-emit that dropped
           * the field fell through to a text comparison against a turn_order
           * turn whose text had never been recorded, so the duplicate sailed
           * through. Both signals are now recorded independently and BOTH must
           * indicate a repeat before the frame is dropped.
           */
          const turnOrder =
            typeof turn.turn_order === "number" ? turn.turn_order : null;
          const normalized = transcript.toLowerCase();

          const sameOrder =
            turnOrder !== null && turnOrder === this.lastFinalTurnOrder;
          const sameText = normalized === this.lastFinalText;

          if (sameOrder || sameText) {
            return;
          }

          if (turnOrder !== null) {
            this.lastFinalTurnOrder = turnOrder;
          }

          this.lastFinalText = normalized;

          /*
           * The reported language rides along with the finalized text, but
           * only when it is present at a confidence worth acting on — the
           * caller treats it as the WEAKEST evidence for the lock (below
           * instructions and script), so a shaky report must arrive as "no
           * report" rather than as a nudge.
           */
          const languageCode =
            typeof turn.language_code === "string" &&
            turn.language_code.length > 0 &&
            (typeof turn.language_confidence !== "number" ||
              turn.language_confidence >= MIN_REPORTED_LANGUAGE_CONFIDENCE)
              ? turn.language_code
              : undefined;

          callbacks.onFinal(transcript, languageCode);
        } else {
          callbacks.onPartial(transcript);
        }
        return;
      }

      case "Error": {
        const error = message as { error?: string; message?: string };
        this.failed = true;
        const text =
          error.error ?? error.message ?? "AssemblyAI reported an error.";
        callbacks.onError(text);
        reject(new Error(text));
        return;
      }

      default:
        // Heartbeat / SpeechStarted / SpeakerRevision / Termination are not
        // needed for the Day-1 loop.
        return;
    }
  }

  /** Forward a PCM chunk. Silently drops if the socket is not open. */
  sendAudio(chunk: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
    }
  }

  /**
   * Send AssemblyAI the documented `UpdateConfiguration` message carrying the
   * keyterm list and the domain context.
   *
   * Sent as a JSON message rather than URL query parameters on purpose: the
   * message form is documented with a real array (`keyterms_prompt: string[]`),
   * so the terms are unambiguous — no guessing at how an array is serialised
   * into a query string.
   *
   * Failure is silent by design: speech biasing is an accuracy improvement, so
   * a rejected configuration must never take down a working stream.
   */
  private applySpeechBiasing(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(sttConfigurationMessage());
    } catch {
      // Accuracy hint only — the transcript is still perfectly usable.
    }
  }

  /** True once the session is established and audio may be sent. */
  get isReady(): boolean {
    return this.sessionReady && this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Gracefully ends the session.
   *
   * IMPORTANT: AssemblyAI bills per session *duration*, so we always send
   * `Terminate` rather than just dropping the socket.
   */
  terminate(): void {
    this.closingIntentionally = true;

    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({ type: "Terminate" }));
      } catch {
        // Fall through to close() below.
      }
      this.socket.close(1000);
    } else if (this.socket) {
      this.socket.close();
    }

    this.socket = null;
    this.callbacks = null;
    this.sessionReady = false;
    this.lastFinalTurnOrder = null;
    this.lastFinalText = "";
  }
}
