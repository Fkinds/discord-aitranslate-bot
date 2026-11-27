import { describe, it, expect } from '@jest/globals';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../../../../src/domain/language-code';
import { KEEP_THE_TONE, promptFor, useTheseTerms } from '../../../../src/infrastructure/translategemma/prompt';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');

describe('promptFor', () => {
  it("asks as the model card does, naming each language in English and by its code, with the text after two blank lines", () => {
    expect(promptFor('うん、それでいいよ', JA, KO, false)).toBe(
      'You are a professional Japanese (ja) to Korean (ko) translator. ' +
        'Your goal is to accurately convey the meaning and nuances of the original Japanese text ' +
        'while adhering to Korean grammar, vocabulary, and cultural sensitivities.\n' +
        'Produce only the Korean translation, without any additional explanations or commentary. ' +
        'Please translate the following Japanese text into Korean:\n\n\nうん、それでいいよ'
    );
  });

  it('asks to keep the tone just before asking for the translation', () => {
    expect(promptFor('うん、それでいいよ', JA, KO, true)).toContain(
      'without any additional explanations or commentary. ' +
        'Keep the speech level of the original: casual speech stays casual, polite speech stays polite. ' +
        'Please translate the following Japanese text into Korean:'
    );
    expect(promptFor('うん', JA, KO, false)).not.toContain(KEEP_THE_TONE);
  });

  it("asks to translate the glossary's terms as it says, after the tone, just before asking for the translation", () => {
    const terms = [
      { said: 'マーシー', translation: '메르시' },
      { said: 'ウルト', translation: '궁' },
    ];

    expect(promptFor('マーシーのウルト', JA, KO, true, terms)).toContain(
      'casual speech stays casual, polite speech stays polite. ' +
        'Translate these terms as given: マーシー → 메르시; ウルト → 궁. ' +
        'Please translate the following Japanese text into Korean:\n\n\nマーシーのウルト'
    );
    expect(promptFor('マーシーのウルト', JA, KO, false, terms)).toContain(
      'commentary. Translate these terms as given: マーシー → 메르시; ウルト → 궁. Please translate'
    );
    expect(promptFor('うん', JA, KO, true, [])).toBe(promptFor('うん', JA, KO, true));
    expect(useTheseTerms([{ said: '草', translation: 'ㅋㅋ' }])).toBe('Translate these terms as given: 草 → ㅋㅋ.');
  });

  it('names Chinese by its ISO 639-1 code, as the model card asks', () => {
    expect(promptFor('你好', LanguageCode.of('zh'), KO, true)).toMatch(/^You are a professional Chinese \(zh\) to Korean \(ko\) translator\./);
  });

  it('takes every language offered in the commands, both ways', () => {
    for (const from of SUPPORTED_LANGUAGES) {
      for (const into of SUPPORTED_LANGUAGES) expect(() => promptFor('text', from, into, true)).not.toThrow();
    }
  });

  it('refuses a language it has no English name for', () => {
    expect(() => promptFor('Xin chào', LanguageCode.of('vi'), JA, true)).toThrow(RangeError);
  });
});
