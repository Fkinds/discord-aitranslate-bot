/** How far what was heard is from what was said: the characters to change, and the characters said. */
export interface Errors {
  readonly edits: number;
  readonly characters: number;
}

/**
 * The characters of the text as they are compared: in Unicode NFKC, in lower
 * case, without white space, punctuation or symbols, which Whisper writes as
 * it likes and which are not what is measured.
 */
export function comparable(text: string): string[] {
  return [...text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')];
}

/** The fewest characters to insert, delete or replace to make `heard` into `said` (Levenshtein distance). */
export function editDistance(said: readonly string[], heard: readonly string[]): number {
  let previous = Array.from({ length: heard.length + 1 }, (_, j) => j);
  for (let i = 1; i <= said.length; i++) {
    const current = [i];
    for (let j = 1; j <= heard.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (said[i - 1] === heard[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[heard.length]!;
}

/** The errors in what was heard, against what was said, character by character. */
export function errorsIn(said: string, heard: string): Errors {
  const reference = comparable(said);
  return { edits: editDistance(reference, comparable(heard)), characters: reference.length };
}

/** The character error rate of them all: their edits over their characters; 0 when nothing was said. */
export function characterErrorRate(errors: readonly Errors[]): number {
  const characters = errors.reduce((sum, e) => sum + e.characters, 0);
  return characters === 0 ? 0 : errors.reduce((sum, e) => sum + e.edits, 0) / characters;
}
