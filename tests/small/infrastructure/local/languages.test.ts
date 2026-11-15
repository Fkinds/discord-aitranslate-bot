import { describe, it, expect } from '@jest/globals';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../../../../src/domain/language-code';
import { englishNameOf, translatesInto } from '../../../../src/infrastructure/local/languages';

describe('translatesInto', () => {
  it('translates into every language offered in the commands', () => {
    expect(SUPPORTED_LANGUAGES.filter((language) => !translatesInto(language))).toEqual([]);
  });

  it.each(['zh-TW', 'vi', 'ja-JP'])('does not translate into %s, which the commands do not offer', (tag) => {
    expect(translatesInto(LanguageCode.of(tag))).toBe(false);
  });
});

describe('englishNameOf', () => {
  it('names each language offered in the commands in English', () => {
    expect(SUPPORTED_LANGUAGES.map(englishNameOf)).toEqual([
      'Japanese',
      'English',
      'Korean',
      'Chinese',
      'Spanish',
      'French',
      'German',
      'Italian',
      'Portuguese',
      'Russian',
    ]);
  });

  it('refuses a language the local translator does not translate into', () => {
    expect(() => englishNameOf(LanguageCode.of('vi'))).toThrow(RangeError);
  });
});
