import path from 'node:path';
import { OfflineRecognizer } from 'sherpa-onnx-node';
import type { LanguageCode } from '../../domain/language-code';
import { SpeechAudio } from '../../usecases/ports/speech-audio';
import { SENSEVOICE_MODEL, type ModelFile } from './model-files';
import { samplesOf, SpeechFinder } from './speech-finder';
import type { Heard, RecognizerOptions, SpeechRecognizer } from './whisper-recognizer';

/** The languages SenseVoice tells, as it names them. */
const LANGUAGE = /^<\|([a-z]+)\|>$/;

/**
 * Hears speech with SenseVoice-Small, after Silero VAD has found the stretches
 * of speech in it, as WhisperRecognizer does, to compare the two. It writes
 * numbers and punctuation as written text does. Each stretch is heard on its
 * own; the language is the one heard in the longest.
 *
 * SenseVoice cannot be told to tell what was said among a few languages: it
 * tells among all it knows, Chinese, English, Japanese, Korean and Cantonese,
 * whatever languages it is given.
 *
 * Recognize one utterance at a time: the models are not shared between calls.
 */
export class SenseVoiceRecognizer implements SpeechRecognizer {
  private constructor(
    private readonly speech: SpeechFinder,
    private readonly senseVoice: OfflineRecognizer
  ) {}

  /** Load the models from `modelsDir`, where `pnpm models:download --candidates` put them. */
  static async load(modelsDir: string, options: RecognizerOptions): Promise<SenseVoiceRecognizer> {
    const at = (file: ModelFile) => path.join(modelsDir, ...file.path.split('/'));
    const senseVoice = await OfflineRecognizer.createAsync({
      modelConfig: {
        senseVoice: { model: at(SENSEVOICE_MODEL.model), language: 'auto', useInverseTextNormalization: 1 },
        tokens: at(SENSEVOICE_MODEL.tokens),
        numThreads: options.threads,
        provider: 'cpu',
        debug: false,
      },
    });
    return new SenseVoiceRecognizer(SpeechFinder.load(modelsDir), senseVoice);
  }

  async recognize(audio: SpeechAudio, _among: readonly LanguageCode[] = []): Promise<Heard> {
    const stretches = this.speech.stretchesIn(samplesOf(audio));
    const speech = {
      speechMs: (stretches.reduce((sum, stretch) => sum + stretch.length, 0) / SpeechAudio.SAMPLE_RATE_HZ) * 1000,
      stretches: stretches.length,
    };
    const heard: Array<{ text: string; language: string | null; samples: number }> = [];
    for (const stretch of stretches) {
      const stream = this.senseVoice.createStream();
      stream.acceptWaveform({ sampleRate: SpeechAudio.SAMPLE_RATE_HZ, samples: stretch });
      const result = await this.senseVoice.decodeAsync(stream);
      const text = result.text.trim();
      if (text !== '') heard.push({ text, language: languageOf(result.lang), samples: stretch.length });
    }
    if (heard.length === 0) return { text: '', language: null, ...speech };
    const longest = heard.reduce((a, b) => (b.samples > a.samples ? b : a));
    return { text: heard.map((part) => part.text).join(' '), language: longest.language, ...speech };
  }
}

/** The language SenseVoice heard, by its code, from how it names it, such as "<|ja|>"; null for none it names, such as "<|nospeech|>". */
export function languageOf(lang: string): string | null {
  const code = LANGUAGE.exec(lang)?.[1];
  return code === undefined || code === 'nospeech' ? null : code;
}
