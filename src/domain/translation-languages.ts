import type { LanguageCode } from './language-code';
import { DomainError } from './shared/domain-error';
import { frozen, ValueObject } from './shared/value-object';

/**
 * The languages a session translates into: one language, or a pair of two
 * different languages.
 *
 * With one language, what is said is translated into it. With a pair, what is
 * said in one is translated into the other, and anything else into both.
 */
export class TranslationLanguages extends ValueObject {
  private constructor(private readonly list: readonly LanguageCode[]) {
    super();
  }

  /** @throws DomainError when the second language is the first one again. */
  static of(first: LanguageCode, second?: LanguageCode): TranslationLanguages {
    if (second?.equals(first)) {
      throw new DomainError(`A pair needs two different languages, got ${first.tag} twice`);
    }
    return frozen(new TranslationLanguages(Object.freeze(second ? [first, second] : [first])));
  }

  /** The languages, the first one first. */
  get languages(): readonly LanguageCode[] {
    return this.list;
  }

  get first(): LanguageCode {
    return this.list[0]!;
  }

  get isPair(): boolean {
    return this.list.length === 2;
  }

  /** "Japanese (日本語)", or for a pair "Japanese (日本語) ⇄ Korean (한국어)". */
  get displayName(): string {
    return this.list.map((language) => language.displayName).join(' ⇄ ');
  }

  includes(language: LanguageCode): boolean {
    return this.list.some((mine) => mine.equals(language));
  }

  /**
   * The languages to post what was said in `spoken` in: every language of
   * these but the spoken one. So a pair gives the other language of the pair,
   * or both when neither was spoken; one language gives that language, or
   * nothing when it was the one spoken.
   *
   * @param spoken the language that was spoken, or null when it is not known.
   */
  targetsFor(spoken: LanguageCode | null): readonly LanguageCode[] {
    return this.list.filter((language) => !spoken?.equals(language));
  }

  protected equalityComponents(): readonly unknown[] {
    return this.list;
  }

  toString(): string {
    return this.list.map((language) => language.tag).join(',');
  }
}
