import path from 'node:path';
import { OfflineRecognizer, Vad } from 'sherpa-onnx-node';
import type { LanguageCode } from '../../domain/language-code';
import type { TranslationLanguages } from '../../domain/translation-languages';
import { SpeechAudio } from '../../usecases/ports/speech-audio';
import { VAD_MODEL, WHISPER_MODEL, type ModelFile } from './model-files';

/** What was heard in speech. */
export interface Heard {
  /** What was said, word for word; empty when no speech was heard. */
  readonly text: string;
  /** The language Whisper heard, by its code such as "ja"; null when no speech was heard. */
  readonly language: string | null;
}

/** Hears what was said in speech, and in which language. */
export interface SpeechRecognizer {
  recognize(audio: SpeechAudio): Promise<Heard>;
}

export interface RecognizerOptions {
  /** The CPU threads Whisper may use. */
  readonly threads: number;
}

/** Whisper takes at most 30 s at a time, so longer speech is cut into stretches of at most this long. */
const MAX_STRETCH_SECONDS = 20;
/** The samples Silero VAD takes at a time at 16 kHz. */
const VAD_WINDOW = 512;

/**
 * Hears speech with Whisper large-v3-turbo, after Silero VAD has found the
 * stretches of speech in it. Silence and noise, in which Whisper is known to
 * hear words nobody said, never reach Whisper. Each stretch of speech is
 * transcribed on its own; the language is the one heard in the longest.
 *
 * Recognize one utterance at a time: the models are not shared between calls.
 */
export class WhisperRecognizer implements SpeechRecognizer {
  private constructor(
    private readonly vad: Vad,
    private readonly whisper: OfflineRecognizer
  ) {}

  /** Load the models from `modelsDir`, where `pnpm models:download` put them. */
  static async load(modelsDir: string, options: RecognizerOptions): Promise<WhisperRecognizer> {
    const at = (file: ModelFile) => path.join(modelsDir, ...file.path.split('/'));
    const vad = new Vad(
      {
        sileroVad: {
          model: at(VAD_MODEL.model),
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
    const whisper = await OfflineRecognizer.createAsync({
      modelConfig: {
        whisper: { encoder: at(WHISPER_MODEL.encoder), decoder: at(WHISPER_MODEL.decoder), language: '', task: 'transcribe' },
        tokens: at(WHISPER_MODEL.tokens),
        numThreads: options.threads,
        provider: 'cpu',
        debug: false,
      },
    });
    return new WhisperRecognizer(vad, whisper);
  }

  async recognize(audio: SpeechAudio): Promise<Heard> {
    const heard: Array<{ text: string; language: string; samples: number }> = [];
    for (const stretch of this.speechIn(samplesOf(audio))) {
      const stream = this.whisper.createStream();
      stream.acceptWaveform({ sampleRate: SpeechAudio.SAMPLE_RATE_HZ, samples: stretch });
      const result = await this.whisper.decodeAsync(stream);
      const text = result.text.trim();
      if (text !== '') heard.push({ text, language: result.lang, samples: stretch.length });
    }
    if (heard.length === 0) return { text: '', language: null };
    const longest = heard.reduce((a, b) => (b.samples > a.samples ? b : a));
    return { text: heard.map((part) => part.text).join(' '), language: longest.language || null };
  }

  /** The stretches of speech in the samples; none in silence or noise. */
  private speechIn(samples: Float32Array): Float32Array[] {
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

/**
 * The session's language that Whisper heard, or null for any other language.
 * Whisper names the languages offered in the commands by their language tags,
 * such as "ja" and "ko".
 */
export function spokenLanguageAmong(languages: TranslationLanguages, heard: string | null): LanguageCode | null {
  return languages.languages.find((language) => language.tag === heard) ?? null;
}
