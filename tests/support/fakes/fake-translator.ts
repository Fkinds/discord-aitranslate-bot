import type { LanguageCode } from '../../../src/domain/language-code';
import type { SpeechAudio } from '../../../src/usecases/ports/speech-audio';
import type { Translation, Translator } from '../../../src/usecases/ports/translator';

/** A Translator that records requests, answers from them, and can be told to fail. */
export class FakeTranslator implements Translator {
  readonly requests: Array<{ bytes: number; targetLanguage: string }> = [];
  private error: Error | undefined;

  /** Make the next translation fail with this error. */
  failNext(error: Error): void {
    this.error = error;
  }

  async translate(audio: SpeechAudio, targetLanguage: LanguageCode): Promise<Translation> {
    this.requests.push({ bytes: audio.pcm.byteLength, targetLanguage: targetLanguage.tag });
    const error = this.error;
    this.error = undefined;
    if (error) throw error;
    return {
      original: `${audio.pcm.byteLength} bytes of speech`,
      translated: `translated into ${targetLanguage.tag}`,
      detectedLanguage: 'en',
    };
  }
}
