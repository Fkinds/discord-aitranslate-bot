import { describe, it, expect } from '@jest/globals';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../../../src/domain/language-code';
import { DomainError } from '../../../src/domain/shared/domain-error';

describe('LanguageCode', () => {
  describe('of', () => {
    it.each([
      ['ja', 'ja'],
      ['EN', 'en'],
      ['zh-tw', 'zh-TW'],
      ['pt-BR', 'pt-BR'],
      ['sr-Latn', 'sr-Latn'],
      ['fil', 'fil'],
    ])('accepts %s as %s', (input, canonical) => {
      expect(LanguageCode.of(input).tag).toBe(canonical);
    });

    it.each([
      ['an empty string', ''],
      ['an underscore', 'ja_JP'],
      ['surrounding spaces', ' ja '],
      ['a one-letter language', 'j'],
      ['a trailing hyphen', 'ja-'],
      ['a language name', 'Japanese (日本語)'],
    ])('rejects %s', (_case, input) => {
      expect(() => LanguageCode.of(input)).toThrow(DomainError);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(LanguageCode.of('ja'))).toBe(true);
    });
  });

  describe('displayName', () => {
    it('names a language offered as a choice', () => {
      expect(LanguageCode.of('ja').displayName).toBe('Japanese (日本語)');
      expect(LanguageCode.of('EN').displayName).toBe('English');
    });

    it('falls back to the tag for any other language', () => {
      expect(LanguageCode.of('zh-TW').displayName).toBe('zh-TW');
    });
  });

  it('is equal when the canonical tags are equal', () => {
    expect(LanguageCode.of('zh-tw').equals(LanguageCode.of('zh-TW'))).toBe(true);
    expect(LanguageCode.of('zh').equals(LanguageCode.of('zh-TW'))).toBe(false);
  });

  it('prints as its tag', () => {
    expect(`${LanguageCode.of('ZH-tw')}`).toBe('zh-TW');
  });
});

describe('SUPPORTED_LANGUAGES', () => {
  it('offers the ten languages of the slash commands, in their order', () => {
    expect(SUPPORTED_LANGUAGES.map((language) => language.tag)).toEqual([
      'ja', 'en', 'ko', 'zh', 'es', 'fr', 'de', 'it', 'pt', 'ru',
    ]);
  });

  it('cannot be changed', () => {
    expect(Object.isFrozen(SUPPORTED_LANGUAGES)).toBe(true);
  });
});
