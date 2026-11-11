import type { TranslationLanguages } from '../domain/translation-languages';
import { SpeechAudio } from '../usecases/ports/speech-audio';
import type { SpeechTranslation, Translator } from '../usecases/ports/translator';

/**
 * Stands in for a translator, so that the bot runs without a Gemini API key
 * and at no cost (TRANSLATOR=fake). It does not listen: it does not know
 * which language was spoken, and it says how long the speech was and the
 * language it would be translated into.
 */
export class PlaceholderTranslator implements Translator {
  async translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    const bytesPerSecond = (SpeechAudio.SAMPLE_RATE_HZ * SpeechAudio.CHANNELS * SpeechAudio.BITS_PER_SAMPLE) / 8;
    const seconds = (audio.pcm.byteLength / bytesPerSecond).toFixed(1);
    return {
      original: `(${seconds} s of speech)`,
      spokenLanguage: null,
      translations: languages.languages.map((language) => ({
        language,
        text: `(${seconds} s of speech, not translated into ${language.displayName}: TRANSLATOR=fake)`,
      })),
    };
  }
}
