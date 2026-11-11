import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../src/domain/language-code';
import { DomainError } from '../../../src/domain/shared/domain-error';
import { TranslationLanguages } from '../../../src/domain/translation-languages';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const EN = LanguageCode.of('en');
const tags = (languages: readonly LanguageCode[]) => languages.map((language) => language.tag);

describe('TranslationLanguages', () => {
  it('is one language', () => {
    const one = TranslationLanguages.of(JA);

    expect(tags(one.languages)).toEqual(['ja']);
    expect(one.first.equals(JA)).toBe(true);
    expect(one.isPair).toBe(false);
  });

  it('is a pair of two languages, in the order given', () => {
    const pair = TranslationLanguages.of(KO, JA);

    expect(tags(pair.languages)).toEqual(['ko', 'ja']);
    expect(pair.first.equals(KO)).toBe(true);
    expect(pair.isPair).toBe(true);
  });

  it('is never a pair of one language twice', () => {
    expect(() => TranslationLanguages.of(JA, LanguageCode.of('JA'))).toThrow(DomainError);
  });

  it('is equal by its languages and their order', () => {
    expect(TranslationLanguages.of(JA, KO).equals(TranslationLanguages.of(JA, KO))).toBe(true);
    expect(TranslationLanguages.of(JA, KO).equals(TranslationLanguages.of(KO, JA))).toBe(false);
    expect(TranslationLanguages.of(JA).equals(TranslationLanguages.of(JA, KO))).toBe(false);
  });

  it('cannot be changed', () => {
    const pair = TranslationLanguages.of(JA, KO);

    expect(Object.isFrozen(pair)).toBe(true);
    expect(Object.isFrozen(pair.languages)).toBe(true);
  });

  it('shows its names, a pair joined by ⇄', () => {
    expect(TranslationLanguages.of(JA).displayName).toBe('Japanese (日本語)');
    expect(TranslationLanguages.of(JA, KO).displayName).toBe('Japanese (日本語) ⇄ Korean (한국어)');
    expect(TranslationLanguages.of(JA, KO).toString()).toBe('ja,ko');
  });

  it('knows which languages it has', () => {
    expect(TranslationLanguages.of(JA, KO).includes(KO)).toBe(true);
    expect(TranslationLanguages.of(JA, KO).includes(EN)).toBe(false);
  });

  describe('targetsFor', () => {
    const cases: Array<[string, [LanguageCode, LanguageCode?], LanguageCode | null, string[]]> = [
      ['a pair, one of its languages spoken: the other one', [JA, KO], JA, ['ko']],
      ['a pair, the other one spoken: the first one', [JA, KO], KO, ['ja']],
      ['a pair, another language spoken: both', [JA, KO], EN, ['ja', 'ko']],
      ['a pair, the language unknown: both', [JA, KO], null, ['ja', 'ko']],
      ['one language, another spoken: that language', [JA], EN, ['ja']],
      ['one language, the language unknown: that language', [JA], null, ['ja']],
      ['one language, that one spoken: none, so only what was said is posted', [JA], JA, []],
    ];

    it.each(cases)('%s', (_, [first, second], spoken, targets) => {
      expect(tags(TranslationLanguages.of(first, second).targetsFor(spoken))).toEqual(targets);
    });
  });
});
