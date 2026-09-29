/**
 * PCM framing rules for AssemblyAI's real-time endpoint.
 *
 * The endpoint enforces a hard limit per audio frame: anything below 50 ms or
 * above 1000 ms closes the session with "Input Duration Violation". The capture
 * graph hands us whatever block size the browser chooses — an `AudioWorklet`
 * delivers 128-sample quanta, which is ~8 ms at 16 kHz — so every outbound frame
 * must be re-buffered into a known-good window.
 *
 * Pure functions plus one small buffer class, so this is testable without a
 * browser, a microphone, or a network connection.
 */

/** AssemblyAI's documented floor. Below this the session is closed. */
export const MIN_AUDIO_FRAME_MS = 50;
/** Our target: comfortably inside the window, low enough to stay responsive. */
export const TARGET_AUDIO_FRAME_MS = 100;
/** AssemblyAI's documented ceiling. */
export const MAX_AUDIO_FRAME_MS = 1000;

/** Mono, 16-bit signed little-endian (`pcm_s16le`). */
export const BYTES_PER_SAMPLE = 2;

/** Samples needed to cover `ms` at `sampleRate`. */
export function frameSamples(sampleRate: number, ms: number): number {
  return Math.max(1, Math.round((sampleRate * ms) / 1000));
}

/** Duration of a PCM buffer in milliseconds. */
export function frameDurationMs(
  byteLength: number,
  sampleRate: number,
): number {
  if (sampleRate <= 0) {
    return 0;
  }

  return (byteLength / BYTES_PER_SAMPLE / sampleRate) * 1000;
}

/** Would AssemblyAI accept a frame of this size? */
export function isSendableFrame(
  byteLength: number,
  sampleRate: number,
): boolean {
  const durationMs = frameDurationMs(byteLength, sampleRate);

  return durationMs >= MIN_AUDIO_FRAME_MS && durationMs <= MAX_AUDIO_FRAME_MS;
}

/**
 * Accumulates raw float samples and releases fixed-size Int16 PCM frames.
 *
 * Fixed framing is the whole point: the caller never has to reason about the
 * incoming block size, so an 8 ms worklet quantum and a 256 ms script-processor
 * block both produce identical, valid frames.
 */
export class PcmFrameChunker {
  private frame: Int16Array;
  private offset = 0;
  private readonly frameByteLength: number;

  constructor(sampleRate: number) {
    this.frame = new Int16Array(frameSamples(sampleRate, TARGET_AUDIO_FRAME_MS));
    this.frameByteLength = this.frame.length * BYTES_PER_SAMPLE;
  }

  /** Size of every frame this chunker emits, in bytes. */
  get bytesPerFrame(): number {
    return this.frameByteLength;
  }

  /**
   * Append float samples and return every COMPLETE frame produced so far.
   *
   * Returns an array because one large incoming block can yield several frames.
   * A partial frame is retained internally and completed by a later call.
   */
  push(samples: Float32Array): ArrayBuffer[] {
    const frames: ArrayBuffer[] = [];

    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      this.frame[this.offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.offset += 1;

      if (this.offset === this.frame.length) {
        // Copy out: the working buffer is reused for the next frame.
        const out = new ArrayBuffer(this.frameByteLength);
        new Int16Array(out).set(this.frame);
        frames.push(out);
        this.offset = 0;
      }
    }

    return frames;
  }
}
