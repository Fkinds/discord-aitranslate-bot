import type { LanguageCode } from '../../domain/language-code';

/**
 * What in a translation shows that it went wrong, by the text alone:
 * - `empty`: there is nothing in it.
 * - `other-script`: it has letters of the source language's script that the
 *   target language is not written in, such as kana in Korean.
 * - `added-parenthesis`: it has parentheses the source has not, as when the
 *   model adds a note or an alternative.
 * - `added-line-break`: it has a line break the source has not.
 * - `too-long`: it is longer than three times the source and 20 characters.
 */
export type TranslationProblem = 'empty' | 'other-script' | 'added-parenthesis' | 'added-line-break' | 'too-long';

/**
 * The scripts each language is written in, as Unicode script names, but for
 * the Latin script: a translation into any of the languages may keep names
 * and borrowed words in it, so letters in it show nothing.
 */
const SCRIPTS: ReadonlyMap<string, readonly string[]> = new Map([
  ['ja', ['Hiragana', 'Katakana', 'Han']],
  ['ko', ['Hangul']],
  ['zh', ['Han']],
  ['ru', ['Cyrillic']],
]);

const PARENTHESES = /[()（）]/u;
const LINE_BREAK = /\n/u;

/**
 * What in the translation of `source` from one language into another shows
 * that it went wrong (TranslationProblem); empty when nothing does. In a trial
 * with the 12B model, this caught 4 of 72 translations, none of which was
 * right (#86).
 */
export function problemsOf(
  source: string,
  translation: string,
  from: LanguageCode,
  into: LanguageCode
): readonly TranslationProblem[] {
  const problems: TranslationProblem[] = [];
  if (translation.trim() === '') problems.push('empty');
  if (otherScriptIn(translation, from, into)) problems.push('other-script');
  if (PARENTHESES.test(translation) && !PARENTHESES.test(source)) problems.push('added-parenthesis');
  if (LINE_BREAK.test(translation) && !LINE_BREAK.test(source)) problems.push('added-line-break');
  if (lengthOf(translation) > 3 * lengthOf(source) + 20) problems.push('too-long');
  return problems;
}

/** Whether the translation has letters of a script `from` is written in and `into` is not. */
function otherScriptIn(translation: string, from: LanguageCode, into: LanguageCode): boolean {
  const target = SCRIPTS.get(into.tag) ?? [];
  const foreign = (SCRIPTS.get(from.tag) ?? []).filter((script) => !target.includes(script));
  if (foreign.length === 0) return false;
  return new RegExp(`[${foreign.map((script) => `\\p{Script=${script}}`).join('')}]`, 'u').test(translation);
}

/** The length in characters, counting each code point once. */
function lengthOf(text: string): number {
  return [...text].length;
}

/** The quotation marks a translation may come wrapped in, opening and closing. */
const QUOTATION_MARKS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['«', '»'],
  ['„', '“'],
];

/**
 * The translation trimmed, and without the pair of quotation marks the whole
 * of it may be wrapped in. Marks that also quote something inside, as in
 * `"yes" or "no"`, are kept.
 */
export function unquoted(translation: string): string {
  const trimmed = translation.trim();
  const chars = [...trimmed];
  if (chars.length < 2) return trimmed;
  const inner = chars.slice(1, -1).join('');
  const wrapped = QUOTATION_MARKS.some(
    ([open, close]) => chars[0] === open && chars.at(-1) === close && !inner.includes(open) && !inner.includes(close)
  );
  return wrapped ? inner.trim() : trimmed;
}
