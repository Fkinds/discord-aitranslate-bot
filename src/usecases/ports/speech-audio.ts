import { frozen } from '../../domain/shared/value-object';

/**
 * Speech as raw PCM: 16-bit signed little-endian samples at 16 kHz, one
 * channel. The voice receiver produces it and the translator takes it.
 */
export class SpeechAudio {
  static readonly SAMPLE_RATE_HZ = 16_000;
  static readonly CHANNELS = 1;
  static readonly BITS_PER_SAMPLE = 16;

  private constructor(readonly pcm: Uint8Array) {}

  /**
   * The bytes are kept as they are, not copied.
   * @throws RangeError when the bytes are not whole 16-bit samples.
   */
  static fromPcm(pcm: Uint8Array): SpeechAudio {
    if (pcm.byteLength % 2 !== 0) {
      throw new RangeError(`PCM must be whole 16-bit samples, got ${pcm.byteLength} bytes`);
    }
    return frozen(new SpeechAudio(pcm));
  }

  /** Nothing was heard. */
  get isEmpty(): boolean {
    return this.pcm.byteLength === 0;
  }
}
