import type { LanguageCode } from '../../domain/language-code';
import type { SpeechAudio } from './speech-audio';

/** What a speaker said, and its translation. */
export interface Translation {
  /** What was said, as heard, in the language it was said in. */
  readonly original: string;
  /** What was said, in the target language. */
  readonly translated: string;
  /** The language the translator heard, as the translator names it; for information only. */
  readonly detectedLanguage: string;
}

/** Translating failed for a technical reason, such as the service being unreachable. */
export class TranslationFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Turns speech into text in another language. */
export interface Translator {
  /**
   * Transcribe the speech and translate it into the target language.
   * @throws TranslationFailed when it cannot be translated.
   */
  translate(audio: SpeechAudio, targetLanguage: LanguageCode): Promise<Translation>;
}
