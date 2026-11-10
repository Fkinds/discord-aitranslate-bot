import type { LanguageCode } from '../domain/language-code';
import { SpeechAudio } from '../usecases/ports/speech-audio';
import type { Translation, Translator } from '../usecases/ports/translator';

/** The language subtag for "undetermined" (BCP 47, from ISO 639-2). */
const UNDETERMINED = 'und';

/**
 * Stands in for a translator, so that the bot runs without a Gemini API key
 * and at no cost (TRANSLATOR=fake). It does not listen; it posts how long
 * the speech was and the language it would be translated into.
 */
export class PlaceholderTranslator implements Translator {
  async translate(audio: SpeechAudio, targetLanguage: LanguageCode): Promise<Translation> {
    const bytesPerSecond = (SpeechAudio.SAMPLE_RATE_HZ * SpeechAudio.CHANNELS * SpeechAudio.BITS_PER_SAMPLE) / 8;
    const seconds = (audio.pcm.byteLength / bytesPerSecond).toFixed(1);
    return {
      original: `(${seconds} s of speech)`,
      translated: `(${seconds} s of speech, not translated into ${targetLanguage.displayName}: TRANSLATOR=fake)`,
      detectedLanguage: UNDETERMINED,
    };
  }
}
