import type { LanguageCode } from '../../../src/domain/language-code';
import type { TranslationLanguages } from '../../../src/domain/translation-languages';
import type { SpeechAudio } from '../../../src/usecases/ports/speech-audio';
import type { SpeechTranslation, Translator } from '../../../src/usecases/ports/translator';

/**
 * A Translator that records requests and can be told to fail. It hears
 * "<bytes> bytes of speech" in the language it is told, and translates that
 * into each language as "translated into <tag>".
 */
export class FakeTranslator implements Translator {
  readonly requests: Array<{ bytes: number; languages: string }> = [];
  private error: Error | undefined;
  private spoken: LanguageCode | null = null;
  private silent = false;

  /** Make the next translation fail with this error. */
  failNext(error: Error): void {
    this.error = error;
  }

  /** Hear this language from now on; null for one that is none of the session's. */
  hears(language: LanguageCode | null): void {
    this.spoken = language;
  }

  /** Hear nothing said from now on. */
  hearsNothing(): void {
    this.silent = true;
  }

  async translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    this.requests.push({ bytes: audio.pcm.byteLength, languages: languages.toString() });
    const error = this.error;
    this.error = undefined;
    if (error) throw error;
    return {
      original: this.silent ? '' : `${audio.pcm.byteLength} bytes of speech`,
      spokenLanguage: this.spoken,
      translations: languages.languages.map((language) => ({
        language,
        text: this.silent ? '' : `translated into ${language.tag}`,
      })),
    };
  }
}
