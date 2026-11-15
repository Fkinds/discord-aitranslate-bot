import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { promptFor, tokenLimitFor, translationFrom } from '../../../../src/infrastructure/local/hy-mt-translator';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';

const KO = LanguageCode.of('ko');

describe('promptFor', () => {
  it("asks for the translation alone, in the words of Hy-MT2's model card", () => {
    expect(promptFor('私たちは岩田さんの車でいきました。', KO)).toBe(
      'Translate the following text into Korean. Note that you should only output the translated result without any additional explanation:\n\n' +
        '私たちは岩田さんの車でいきました。'
    );
  });

  it('refuses a language it does not translate into', () => {
    expect(() => promptFor('Hello', LanguageCode.of('vi'))).toThrow(RangeError);
  });
});

describe('tokenLimitFor', () => {
  it('allows twice as many tokens as the text has characters, and 32 more', () => {
    expect(tokenLimitFor('')).toBe(32);
    expect(tokenLimitFor('Hello')).toBe(42);
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(tokenLimitFor('𩸽')).toBe(34);
  });
});

describe('translationFrom', () => {
  it('takes what the model said, without the white space around it', () => {
    expect(translationFrom({ text: ' 안녕하세요\n', stopReason: 'eogToken' }, KO, 42)).toBe('안녕하세요');
  });

  it('takes an answer cut by a stop trigger of the chat template', () => {
    expect(translationFrom({ text: '안녕하세요', stopReason: 'stopGenerationTrigger' }, KO, 42)).toBe('안녕하세요');
  });

  it.each([
    ['ran on to the token limit', { text: '안녕 안녕 안녕', stopReason: 'maxTokens' }, 'ran on to the limit of 42 tokens'],
    ['said nothing', { text: ' \n', stopReason: 'eogToken' }, 'was empty'],
    ['stopped for another reason', { text: '안녕', stopReason: 'abort' }, 'stopped unexpectedly: abort'],
    ['failed', { error: 'out of memory' }, 'failed: out of memory'],
  ])('refuses an answer that %s', (_case, answer, message) => {
    expect(() => translationFrom(answer, KO, 42)).toThrow(TranslationFailed);
    expect(() => translationFrom(answer, KO, 42)).toThrow(message);
  });
});
