import type { LanguageCode } from '../../domain/language-code';
import type { TranslationLanguages } from '../../domain/translation-languages';
import type { SpeechAudio } from './speech-audio';

/** What the translator heard in the speech, and what it says in each of the session's languages. */
export interface SpeechTranslation {
  /** What was said, word for word, in the language it was said in; empty when nothing was said. */
  readonly original: string;
  /** The session's language that was spoken, or null for another language or when it is not known. */
  readonly spokenLanguage: LanguageCode | null;
  /**
   * What was said, in the session's languages, in their order: at least in
   * each that it is to be posted in (TranslationLanguages.targetsFor the
   * spoken language). A translator may leave out the others, and may leave
   * out every one when it cannot translate what was said, such as from a
   * language it does not know.
   */
  readonly translations: ReadonlyArray<{ readonly language: LanguageCode; readonly text: string }>;
}

/** Translating failed for a technical reason, such as the service being unreachable. */
export class TranslationFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The translator gave up on the speech without translating it, as it had
 * waited too long behind the speech before it: a translation that late is of
 * no use to the conversation.
 */
export class TranslationAbandoned extends Error {
  constructor(readonly waitedMs: number) {
    super(`Gave up on the speech after it waited ${waitedMs} ms`);
    this.name = new.target.name;
  }
}

/** Turns speech into text in other languages. */
export interface Translator {
  /**
   * Transcribe the speech and translate it into each of the languages.
   * @throws TranslationFailed when it cannot be translated.
   * @throws TranslationAbandoned when it gave up on the speech for waiting too long.
   */
  translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation>;
}
