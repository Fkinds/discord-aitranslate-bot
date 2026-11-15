import type { LanguageCode } from '../../domain/language-code';

/** What was said, in one language. */
export interface TranslatedText {
  readonly language: LanguageCode;
  readonly text: string;
}

/** Translates text that was said into other languages. */
export interface TextTranslator {
  /**
   * What the text says in each of the languages, in their order.
   * @throws TranslationFailed when it could not be translated.
   */
  translate(text: string, into: readonly LanguageCode[]): Promise<readonly TranslatedText[]>;
}
