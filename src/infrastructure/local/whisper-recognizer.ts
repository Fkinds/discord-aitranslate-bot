import path from 'node:path';
import { OfflineRecognizer } from 'sherpa-onnx-node';
import { LanguageCode } from '../../domain/language-code';
import { DomainError } from '../../domain/shared/domain-error';
import type { TranslationLanguages } from '../../domain/translation-languages';
import { SpeechAudio } from '../../usecases/ports/speech-audio';
import { WHISPER_MODEL, type ModelFile } from './model-files';
import { samplesOf, SpeechFinder } from './speech-finder';

/** What was heard in speech. */
export interface Heard {
  /** What was said, word for word; empty when no speech was heard. */
  readonly text: string;
  /** The language Whisper heard, by its code such as "ja"; null when no speech was heard. */
  readonly language: string | null;
  /** How long the stretches of speech found in it last, in milliseconds; 0 when none was found. */
  readonly speechMs: number;
  /** How many stretches of speech were found in it, each heard on its own. */
  readonly stretches: number;
}

/** Hears what was said in speech, and in which language. */
export interface SpeechRecognizer {
  /**
   * @param among the languages to tell what was said among; any language the
   *   recognizer knows when there are none.
   */
  recognize(audio: SpeechAudio, among?: readonly LanguageCode[]): Promise<Heard>;
}

export interface RecognizerOptions {
  /** The CPU threads Whisper may use. */
  readonly threads: number;
}

/**
 * The most tokens Whisper may write for each second of speech. sherpa-onnx
 * stops decoding there, at 6 unless told otherwise, which cut short what was
 * said quickly in Japanese and Korean. 12 is the value of the example in the
 * change that made it an option (k2-fsa/sherpa-onnx#4211). Decoding still
 * stops at the end of what was said; only a stretch Whisper repeats itself in
 * runs on to the limit.
 */
const MAX_TOKENS_PER_SECOND = 12;

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
    private readonly speech: SpeechFinder,
    private readonly whisper: OfflineRecognizer
  ) {}

  /** Load the models from `modelsDir`, where `pnpm models:download` put them. */
  static async load(modelsDir: string, options: RecognizerOptions): Promise<WhisperRecognizer> {
    const at = (file: ModelFile) => path.join(modelsDir, ...file.path.split('/'));
    const whisper = await OfflineRecognizer.createAsync({
      modelConfig: {
        whisper: { encoder: at(WHISPER_MODEL.encoder), decoder: at(WHISPER_MODEL.decoder), language: '', task: 'transcribe' },
        tokens: at(WHISPER_MODEL.tokens),
        numThreads: options.threads,
        provider: 'cpu',
        debug: false,
      },
    });
    return new WhisperRecognizer(SpeechFinder.load(modelsDir), whisper);
  }

  /**
   * With languages to tell what was said among, Whisper picks the likeliest
   * of them alone (sherpa-onnx's `language_candidates`), in the same pass.
   * They must be languages Whisper knows, by the codes it names them by, such
   * as those offered in the commands.
   */
  async recognize(audio: SpeechAudio, among: readonly LanguageCode[] = []): Promise<Heard> {
    const stretches = this.speech.stretchesIn(samplesOf(audio));
    const speech = {
      speechMs: (stretches.reduce((sum, stretch) => sum + stretch.length, 0) / SpeechAudio.SAMPLE_RATE_HZ) * 1000,
      stretches: stretches.length,
    };
    const heard: Array<{ text: string; language: string; samples: number }> = [];
    for (const stretch of stretches) {
      const stream = this.whisper.createStream();
      stream.setOption('max_tokens_per_second', String(MAX_TOKENS_PER_SECOND));
      if (among.length > 0) stream.setOption('language_candidates', among.map((language) => language.tag).join(','));
      stream.acceptWaveform({ sampleRate: SpeechAudio.SAMPLE_RATE_HZ, samples: stretch });
      const result = await this.whisper.decodeAsync(stream);
      const text = result.text.trim();
      if (text !== '') heard.push({ text, language: result.lang, samples: stretch.length });
    }
    if (heard.length === 0) return { text: '', language: null, ...speech };
    const longest = heard.reduce((a, b) => (b.samples > a.samples ? b : a));
    return { text: heard.map((part) => part.text).join(' '), language: longest.language || null, ...speech };
  }

}

/**
 * The session's language that Whisper heard, or null for any other language.
 * Whisper names the languages offered in the commands by their language tags,
 * such as "ja" and "ko".
 */
export function spokenLanguageAmong(languages: TranslationLanguages, heard: string | null): LanguageCode | null {
  return languages.languages.find((language) => language.tag === heard) ?? null;
}

/** The language Whisper heard, by its code; null when it is not known, or the code is not a language tag. */
export function languageHeard(heard: string | null): LanguageCode | null {
  if (heard === null) return null;
  try {
    return LanguageCode.of(heard);
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}
