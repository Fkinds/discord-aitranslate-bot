import path from 'node:path';
import { Vad } from 'sherpa-onnx-node';
import { SpeechAudio } from '../../usecases/ports/speech-audio';
import { VAD_MODEL } from './model-files';

/**
 * Whisper takes at most 30 s at a time, so longer speech is cut into
 * stretches of about this long. Silero VAD may cut one a little later: at
 * 21.8 s for speech without a pause in a trial, still well under 30 s.
 */
export const MAX_STRETCH_SECONDS = 20;
/** The longest a stretch may be, for Whisper. */
export const WHISPER_MAX_SECONDS = 30;
/** The samples Silero VAD takes at a time at 16 kHz. */
const VAD_WINDOW = 512;

/**
 * Finds the stretches of speech in audio with Silero VAD, so that silence and
 * noise, in which a recognizer is known to hear words nobody said, never reach
 * it. Speech without a pause is cut into stretches of about
 * MAX_STRETCH_SECONDS.
 *
 * Find the speech in one audio at a time: the model is not shared between calls.
 */
export class SpeechFinder {
  private constructor(private readonly vad: Vad) {}

  /** Load Silero VAD from `modelsDir`, where `pnpm models:download` put it. */
  static load(modelsDir: string): SpeechFinder {
    const vad = new Vad(
      {
        sileroVad: {
          model: path.join(modelsDir, ...VAD_MODEL.model.path.split('/')),
          threshold: 0.5,
          minSpeechDuration: 0.25,
          minSilenceDuration: 0.5,
          maxSpeechDuration: MAX_STRETCH_SECONDS,
          windowSize: VAD_WINDOW,
        },
        sampleRate: SpeechAudio.SAMPLE_RATE_HZ,
        numThreads: 1,
        debug: false,
      },
      MAX_STRETCH_SECONDS + 10
    );
    return new SpeechFinder(vad);
  }

  /** The stretches of speech in the samples; none in silence or noise. */
  stretchesIn(samples: Float32Array): Float32Array[] {
    this.vad.reset();
    const stretches: Float32Array[] = [];
    const takeFound = () => {
      while (!this.vad.isEmpty()) {
        stretches.push(this.vad.front(false).samples);
        this.vad.pop();
      }
    };
    for (let start = 0; start + VAD_WINDOW <= samples.length; start += VAD_WINDOW) {
      this.vad.acceptWaveform(samples.subarray(start, start + VAD_WINDOW));
      takeFound();
    }
    this.vad.flush();
    takeFound();
    return stretches;
  }
}

/** The 16-bit samples of the speech as numbers from -1 to 1, as the models take them. */
export function samplesOf(audio: SpeechAudio): Float32Array {
  const pcm = new DataView(audio.pcm.buffer, audio.pcm.byteOffset, audio.pcm.byteLength);
  const samples = new Float32Array(audio.pcm.byteLength / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.getInt16(i * 2, true) / 32_768;
  return samples;
}
