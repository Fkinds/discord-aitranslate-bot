import type { LanguageCode } from '../../domain/language-code';

/**
 * The languages the bot handles when it transcribes with Whisper: those
 * offered in the commands, which Whisper names by these tags
 * (spokenLanguageAmong), with the English names prompts give them.
 */
const ENGLISH_NAMES: ReadonlyMap<string, string> = new Map([
  ['ja', 'Japanese'],
  ['en', 'English'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
]);

/** Whether the local translator translates into the language: it does into those offered in the commands. */
export function translatesInto(language: LanguageCode): boolean {
  return ENGLISH_NAMES.has(language.tag);
}

/**
 * The language's name in English, such as "Korean".
 * @throws RangeError for a language the local translator does not translate into.
 */
export function englishNameOf(language: LanguageCode): string {
  const name = ENGLISH_NAMES.get(language.tag);
  if (name === undefined) throw new RangeError(`The local translator does not translate into ${language.tag}`);
  return name;
}
