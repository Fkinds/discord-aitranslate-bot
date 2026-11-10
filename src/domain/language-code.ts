import { DomainError } from './shared/domain-error';
import { frozen, ValueObject } from './shared/value-object';

/**
 * Display names of the languages offered in the slash commands, in the order
 * they are offered.
 */
const SUPPORTED_NAMES: ReadonlyMap<string, string> = new Map([
  ['ja', 'Japanese (日本語)'],
  ['en', 'English'],
  ['ko', 'Korean (한국어)'],
  ['zh', 'Chinese (中文)'],
  ['es', 'Spanish (Español)'],
  ['fr', 'French (Français)'],
  ['de', 'German (Deutsch)'],
  ['it', 'Italian (Italiano)'],
  ['pt', 'Portuguese (Português)'],
  ['ru', 'Russian (Русский)'],
]);

/**
 * A language to translate into, as a well-formed language tag in canonical
 * form, such as "ja" or "zh-TW".
 *
 * Well-formedness and the canonical form follow ECMA-402
 * Intl.getCanonicalLocales, that is Unicode BCP 47 locale identifiers
 * (UTS #35), which fit the language tags of BCP 47 (RFC 5646) used here. Tags
 * are not checked against the subtag registry. Any well-formed tag is
 * accepted; SUPPORTED_LANGUAGES only lists the ones offered as choices.
 */
export class LanguageCode extends ValueObject {
  private constructor(readonly tag: string) {
    super();
  }

  static of(tag: string): LanguageCode {
    let canonical: string[];
    try {
      canonical = Intl.getCanonicalLocales(tag);
    } catch {
      throw new DomainError(`LanguageCode must be a well-formed language tag such as "ja" or "zh-TW", got ${JSON.stringify(tag)}`);
    }
    return frozen(new LanguageCode(canonical[0]!));
  }

  /** The name to show, or the tag itself for a language not offered as a choice. */
  get displayName(): string {
    return SUPPORTED_NAMES.get(this.tag) ?? this.tag;
  }

  protected equalityComponents(): readonly unknown[] {
    return [this.tag];
  }

  toString(): string {
    return this.tag;
  }
}

/** The languages offered as choices in the slash commands, in that order. */
export const SUPPORTED_LANGUAGES: readonly LanguageCode[] = Object.freeze(
  [...SUPPORTED_NAMES.keys()].map((tag) => LanguageCode.of(tag))
);
