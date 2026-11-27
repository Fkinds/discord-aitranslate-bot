import { characterErrorRate, errorsIn } from './character-error-rate';

/** How a recognizer heard one sentence, one way. */
export interface Hearing {
  /** The language the sentence is in, such as "ja". */
  readonly language: string;
  /** What was said. */
  readonly said: string;
  /** What was heard; empty when nothing was written. */
  readonly heard: string;
  /** The language heard; null when none was. */
  readonly heardLanguage: string | null;
  /** How long the speech lasts. */
  readonly speechMs: number;
  /** How long hearing it took. */
  readonly ms: number;
}

/** How well the sentences of one language were heard. */
export interface Summary {
  readonly language: string;
  readonly sentences: number;
  /** The character error rate, from 0. */
  readonly characterErrorRate: number;
  /** The share of sentences of which nothing was written, from 0 to 1. */
  readonly nothingWritten: number;
  /** The share of sentences heard in their own language, from 0 to 1. */
  readonly rightLanguage: number;
  /** How long hearing a second of speech took, in milliseconds. */
  readonly msPerSecond: number;
}

/** How well the sentences were heard, language by language, in the order the languages first come. */
export function summariesOf(hearings: readonly Hearing[]): Summary[] {
  const languages = [...new Set(hearings.map((hearing) => hearing.language))];
  return languages.map((language) => {
    const of = hearings.filter((hearing) => hearing.language === language);
    const share = (count: number) => count / of.length;
    const speechSeconds = of.reduce((sum, hearing) => sum + hearing.speechMs, 0) / 1000;
    return {
      language,
      sentences: of.length,
      characterErrorRate: characterErrorRate(of.map((hearing) => errorsIn(hearing.said, hearing.heard))),
      nothingWritten: share(of.filter((hearing) => hearing.heard.trim() === '').length),
      rightLanguage: share(of.filter((hearing) => hearing.heardLanguage === language).length),
      msPerSecond: speechSeconds === 0 ? 0 : of.reduce((sum, hearing) => sum + hearing.ms, 0) / speechSeconds,
    };
  });
}
