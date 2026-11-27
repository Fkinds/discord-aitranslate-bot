import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { spokenLanguageAmong } from '../../../../src/infrastructure/local/whisper-recognizer';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');

describe('spokenLanguageAmong', () => {
  const jaKo = TranslationLanguages.of(JA, KO);

  it.each([
    ['ja', JA],
    ['ko', KO],
  ])('takes "%s" for that language of the session', (heard, language) => {
    expect(spokenLanguageAmong(jaKo, heard)).toBe(language);
  });

  it.each([
    ['another language', 'en'],
    ['a variety Whisper tells apart', 'yue'],
    ['no language', null],
  ])('takes %s for none of the session', (_case, heard) => {
    expect(spokenLanguageAmong(jaKo, heard)).toBeNull();
  });

  it('takes the language of a session of one language', () => {
    expect(spokenLanguageAmong(TranslationLanguages.of(JA), 'ja')).toBe(JA);
  });
});
