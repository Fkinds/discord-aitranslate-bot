import { LanguageCode } from '../../domain/language-code';
import { DomainError } from '../../domain/shared/domain-error';

/** A term of the glossary found in what was said, and what to translate it into. */
export interface GlossaryMatch {
  /** The term as the glossary writes it, in the language that was spoken. */
  readonly said: string;
  /** What to translate it into: the first way the glossary writes it in the other language. */
  readonly translation: string;
}

/** A glossary that cannot be read: its first line does not name two languages, a line is not two columns of terms, or a term is written the same on two lines. */
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
 * A glossary is tab-separated values (IANA text/tab-separated-values): its
 * first line names the two languages of its columns by their language tags,
 * and each line after it is one term, written in those two languages. Each
 * column may write the term several ways separated by "|", the first being
 * the one to translate into. Unlike that format, a line that starts with "#"
 * is a note, and an empty line is skipped:
 *
 *     # heroes
 *     ja	ko
 *     マーシー	메르시|메르
 *     ウルト|ult	궁|궁극기
 *
 * A way of writing a term is on one line only, in each language, so that
 * what is said is always found as one term.
 */
export class Glossary {
  private constructor(
    /** The languages of the two columns, in order. */
    readonly languages: readonly [LanguageCode, LanguageCode],
    private readonly terms: readonly Term[]
  ) {}

  /** @throws GlossaryMalformed when it cannot be read, naming the line. */
  static parse(text: string): Glossary {
    let languages: [LanguageCode, LanguageCode] | undefined;
    const terms: Term[] = [];
    /** The line each way of writing a term is on, by language and in the form terms are compared in. */
    const lineOf = new Map<string, number>();
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (line.trim() === '' || line.startsWith('#')) continue;
      const number = i + 1;
      if (languages === undefined) {
        languages = languagesIn(line, number);
        continue;
      }
      const columns = line.split('\t').map((column) =>
        column
          .split('|')
          .map((form) => form.trim())
          .filter((form) => form !== '')
      );
      if (columns.length !== 2 || columns.some((forms) => forms.length === 0)) {
        throw new GlossaryMalformed(`Line ${number} of the glossary is not two columns of terms separated by a tab`);
      }
      for (const [column, forms] of columns.entries()) {
        for (const form of forms) {
          const key = `${languages[column]!.tag}\t${comparable(form)}`;
          const first = lineOf.get(key);
          if (first === number) throw new GlossaryMalformed(`Line ${number} of the glossary writes "${form}" twice`);
          if (first !== undefined) {
            throw new GlossaryMalformed(`Line ${number} of the glossary writes "${form}" as line ${first} does: write it on one line only`);
          }
          lineOf.set(key, number);
        }
      }
      const named = languages;
      terms.push(new Map(named.map((language, column) => [language.tag, columns[column]!])));
    }
    if (languages === undefined) throw new GlossaryMalformed('The glossary is empty: its first line must name its two languages');
    return new Glossary(languages, terms);
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

/** The two languages the first line names, such as "ja" and "ko", separated by a tab. */
function languagesIn(line: string, number: number): [LanguageCode, LanguageCode] {
  const tags = line.split('\t').map((tag) => tag.trim());
  const malformed = (why: string) =>
    new GlossaryMalformed(`Line ${number} of the glossary, its first, must name its two languages by their tags, such as "ja" and "ko": ${why}`);
  if (tags.length !== 2) throw malformed(`it has ${tags.length} columns`);
  try {
    const [first, second] = tags.map((tag) => LanguageCode.of(tag)) as [LanguageCode, LanguageCode];
    if (first.equals(second)) throw malformed(`it names ${first.tag} twice`);
    return [first, second];
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    throw malformed(error.message);
  }
}

/** The text as terms are compared: in Normalization Form KC, with letters in lower case. */
function comparable(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}
