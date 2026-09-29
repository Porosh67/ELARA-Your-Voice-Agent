"use client";

import { PcmFrameChunker } from "@/lib/voice/frames";

/**
 * Microphone capture → framed 16-bit mono PCM.
 *
 * Design notes:
 * - Audio is NEVER stored. Each completed frame is handed straight to
 *   `onChunk`, which forwards it to the WebSocket. Nothing is persisted or
 *   logged. The only buffering is the sub-100 ms assembly window inside
 *   `PcmFrameChunker`, which holds raw samples just long enough to form one
 *   outbound frame.
 * - An `AudioWorklet` moves raw samples off the main thread; quantisation and
 *   framing happen on the main thread in `PcmFrameChunker`. If the browser
 *   lacks `audioWorklet`, we fall back to `ScriptProcessorNode` (still widely
 *   supported) and feed the SAME chunker — so both capture paths emit
 *   identically sized frames.
 * - We request a 16 kHz context but read back the ACTUAL rate the browser gave
 *   us and report it, because browsers are allowed to ignore the request. The
 *   caller passes the real rate to AssemblyAI so the stream stays in sync.
 * - Frame size is load-bearing: AssemblyAI's real-time endpoint rejects any
 *   frame outside 50–1000 ms ("Input Duration Violation"). A raw worklet
 *   quantum is 128 samples — about 8 ms at 16 kHz — which is exactly the bug
 *   this framing exists to prevent.
 */

const WORKLET_PROCESSOR_NAME = "elara-pcm-capture";
const PREFERRED_SAMPLE_RATE = 16_000;
const FALLBACK_BUFFER_SIZE = 4096;

/**
 * Inlined so it stays in TS source and needs no `public/` asset (which the
 * proxy matcher would otherwise have to serve).
 *
 * The worklet only forwards raw samples — all quantisation and framing lives in
 * `PcmFrameChunker`, so there is exactly one implementation of the 50–1000 ms
 * rule to get right.
 */
const WORKLET_SOURCE = `
class ElaraPcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }
    const block = new Float32Array(channel);
    this.port.postMessage(block.buffer, [block.buffer]);
    return true;
  }
}
registerProcessor("${WORKLET_PROCESSOR_NAME}", ElaraPcmCapture);
`;

export interface PcmRecorderCallbacks {
  /** Receives raw little-endian signed 16-bit mono PCM. */
  onChunk: (chunk: ArrayBuffer) => void;
}

/**
 * Turn a `getUserMedia`/AudioContext failure into a message we can show a human.
 * Never surfaces a raw DOM exception string.
 */
export function describeMicrophoneError(error: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return (
      "Microphone access needs a secure context. Open Elara over HTTPS " +
      "(or http://localhost) and try again."
    );
  }

  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone permission was denied. Allow it in your browser and try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect one and try again.";
    case "NotReadableError":
      return "Your microphone is already in use by another app.";
    case "AbortError":
      return "Microphone capture stopped unexpectedly. Please try again.";
    default:
      return "Could not start the microphone. Please try again.";
  }
}

/**
 * Captures mic audio as PCM. One instance per session.
 *
 * Usage:
 *   const recorder = new PcmRecorder({ onChunk: (c) => socket.sendAudio(c) });
 *   const sampleRate = await recorder.start();
 *   ...
 *   recorder.stop();
 */
export class PcmRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private workletUrl: string | null = null;
  /**
   * Re-buffers raw capture blocks into fixed ~100 ms PCM frames. Created once
   * the audio context — and therefore the real sample rate — is known.
   */
  private chunker: PcmFrameChunker | null = null;
  /**
   * Silent sink. Capture nodes must be connected to a destination to be pulled
   * by the audio graph, but we never want the microphone audible in the
   * speakers (that would be an echo/feedback loop for the user).
   */
  private muteNode: GainNode | null = null;

  constructor(private readonly callbacks: PcmRecorderCallbacks) {}

  /**
   * Requests the microphone and begins emitting PCM chunks.
   *
   * Resolves with the ACTUAL sample rate of the audio context (which browsers
   * may set differently from our preferred 16 kHz). Throws an `Error` whose
   * message is already safe to show a user.
   */
  async start(): Promise<number> {
    if (typeof window === "undefined") {
      throw new Error("Microphone capture is browser-only.");
    }

    if (!window.isSecureContext) {
      throw new Error(describeMicrophoneError({ name: "SecurityError" }));
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone capture.");
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (error) {
      throw new Error(describeMicrophoneError(error));
    }

    // Some browsers refuse an explicit sample rate; fall back to their default
    // rather than failing the whole session. The true rate is reported back
    // below, so the stream stays in sync either way.
    let context: AudioContext;

    try {
      context = new AudioContext({ sampleRate: PREFERRED_SAMPLE_RATE });
    } catch {
      context = new AudioContext();
    }

    this.context = context;

    if (context.state === "suspended") {
      await context.resume();
    }

    this.source = context.createMediaStreamSource(this.stream);
    this.chunker = new PcmFrameChunker(context.sampleRate);

    const supportsWorklet =
      typeof context.audioWorklet !== "undefined" &&
      typeof AudioWorkletNode !== "undefined";

    if (supportsWorklet) {
      // Must be awaited: `AudioWorkletNode` cannot be constructed until
      // `addModule()` has registered the processor. See `attachWorklet`.
      await this.attachWorklet(context);
    } else {
      this.attachScriptProcessor(context);
    }

    return context.sampleRate;
  }

  private async attachWorklet(context: AudioContext): Promise<void> {
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    this.workletUrl = url;

    try {
      // ORDER MATTERS. The processor must first be registered in the
      // AudioWorkletGlobalScope by `addModule`; constructing an
      // AudioWorkletNode for an unregistered processor throws InvalidStateError.
      // Resolving the module first is what makes the worklet path usable.
      await context.audioWorklet.addModule(url);
    } catch {
      this.degradeToScriptProcessor();
      return;
    }

    // The recorder may have been stopped while the module was loading.
    if (!this.source || this.context?.state === "closed") {
      this.teardownWorklet();
      return;
    }

    let workletNode: AudioWorkletNode;

    try {
      workletNode = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME);
    } catch {
      this.degradeToScriptProcessor();
      return;
    }

    this.workletNode = workletNode;

    workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.pushSamples(new Float32Array(event.data));
    };

    this.source.connect(workletNode);
    // Pulled through the silent sink so the mic is never audible.
    workletNode.connect(this.ensureMuteNode(context));
  }

  /**
   * Recover from a worklet failure by falling back to ScriptProcessorNode.
   * A degraded capture path still beats a dead session.
   */
  private degradeToScriptProcessor(): void {
    this.teardownWorklet();

    if (this.context && this.context.state !== "closed") {
      this.attachScriptProcessor(this.context);
    }
  }

  /**
   * Lazily creates the zero-gain sink. Capture nodes only emit while connected
   * to a destination, so we route them here instead of straight to the speakers.
   */
  private ensureMuteNode(context: AudioContext): GainNode {
    if (!this.muteNode) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      this.muteNode = gain;
    }

    return this.muteNode;
  }

  private attachScriptProcessor(context: AudioContext): void {
    if (!this.source || this.scriptNode) {
      return;
    }

    const scriptNode = context.createScriptProcessor(FALLBACK_BUFFER_SIZE, 1, 1);
    this.scriptNode = scriptNode;

    scriptNode.onaudioprocess = (event) => {
      // Read synchronously — the input buffer is recycled once this returns.
      this.pushSamples(event.inputBuffer.getChannelData(0));
    };

    this.source.connect(scriptNode);
    // Silent sink, not the speakers — never monitor the microphone back.
    scriptNode.connect(this.ensureMuteNode(context));
  }

  /**
   * Feeds raw float samples into the chunker and emits every COMPLETE frame.
   *
   * This is the single point where audio leaves the recorder, which is why the
   * frame-size guarantee lives here: whatever block size the browser hands us —
   * 128 samples from an `AudioWorklet`, 4096 from `ScriptProcessorNode` — the
   * outbound frames are always exactly one `TARGET_AUDIO_FRAME_MS` window.
   */
  private pushSamples(samples: Float32Array): void {
    const chunker = this.chunker;

    if (!chunker) {
      return;
    }

    for (const frame of chunker.push(samples)) {
      this.callbacks.onChunk(frame);
    }
  }

  private teardownWorklet(): void {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
  }

  /** Idempotent. Stops the mic track and releases every audio resource. */
  stop(): void {
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }

    this.teardownWorklet();
    // Any sub-frame remainder is dropped rather than flushed: flushing could
    // emit a frame below AssemblyAI's 50 ms minimum, which is precisely the
    // failure this framing exists to prevent. Losing < 100 ms of trailing audio
    // is inaudible in practice.
    this.chunker = null;

    if (this.muteNode) {
      this.muteNode.disconnect();
      // Must be cleared: a new session uses a new AudioContext, so a stale node
      // from the previous one would be unusable.
      this.muteNode = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }
}
