import type { LanguageCode } from '../../domain/language-code';

/** A term of the glossary found in what was said, and what to translate it into. */
export interface GlossaryMatch {
  /** The term as the glossary writes it, in the language that was spoken. */
  readonly said: string;
  /** What to translate it into: the first way the glossary writes it in the other language. */
  readonly translation: string;
}

/** A line of a glossary that is not two columns of terms. */
export class GlossaryMalformed extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The ways one term is written, by language tag. */
type Term = ReadonlyMap<string, readonly string[]>;

/**
 * Terms of a domain, such as a game's, and how each is said in two languages,
 * for a translator to translate them as the people who say them do.
 *
 * A glossary is written one term a line, the two languages in two columns
 * separated by a tab. Each column may write the term several ways separated
 * by "|", the first being the one to translate into. A line that starts with
 * "#" is a note, and an empty line is skipped:
 *
 *     # heroes
 *     マーシー	메르시|메르
 *     ウルト|ult	궁|궁극기
 */
export class Glossary {
  private constructor(private readonly terms: readonly Term[]) {}

  /**
   * @param languages the languages of the two columns, in order.
   * @throws GlossaryMalformed for a line that is not two columns of terms, naming it by its number.
   */
  static parse(text: string, languages: readonly [LanguageCode, LanguageCode]): Glossary {
    const terms: Term[] = [];
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (line.trim() === '' || line.startsWith('#')) continue;
      const columns = line.split('\t').map((column) =>
        column
          .split('|')
          .map((form) => form.trim())
          .filter((form) => form !== '')
      );
      if (columns.length !== 2 || columns.some((forms) => forms.length === 0)) {
        throw new GlossaryMalformed(`Line ${i + 1} of the glossary is not two columns of terms separated by a tab`);
      }
      terms.push(new Map(languages.map((language, column) => [language.tag, columns[column]!])));
    }
    return new Glossary(terms);
  }

  /** How many terms it has. */
  get size(): number {
    return this.terms.length;
  }

  /**
   * The terms found in `text`, said in `from`, with what to translate each
   * into in `into`, in the order they come in the text, each once. None when
   * the glossary has neither language.
   *
   * A term is found wherever the text holds one of the ways the glossary
   * writes it, even within a longer word: the text has no spaces between
   * words in Japanese. Where terms overlap, the longest is taken. Text and
   * terms are compared in Unicode Normalization Form KC, with letters in
   * lower case, so that full-width and half-width letters, and capitals, are
   * found alike.
   */
  termsIn(text: string, from: LanguageCode, into: LanguageCode): readonly GlossaryMatch[] {
    const said = comparable(text);
    const candidates: Array<{ start: number; end: number; match: GlossaryMatch; term: Term }> = [];
    for (const term of this.terms) {
      const translation = term.get(into.tag)?.[0];
      if (translation === undefined) continue;
      for (const form of term.get(from.tag) ?? []) {
        const sought = comparable(form);
        for (let start = said.indexOf(sought); start >= 0; start = said.indexOf(sought, start + 1)) {
          candidates.push({ start, end: start + sought.length, match: { said: form, translation }, term });
        }
      }
    }

    const taken: typeof candidates = [];
    for (const candidate of candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
      if (taken.some((other) => candidate.start < other.end && other.start < candidate.end)) continue;
      taken.push(candidate);
    }
    const seen = new Set<Term>();
    const matches: GlossaryMatch[] = [];
    for (const { term, match } of taken.sort((a, b) => a.start - b.start)) {
      if (seen.has(term)) continue;
      seen.add(term);
      matches.push(match);
    }
    return matches;
  }
}

/** The text as terms are compared: in Normalization Form KC, with letters in lower case. */
function comparable(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}
