import { describe, it, expect } from '@jest/globals';
import { languageOf } from '../../../../src/infrastructure/local/sensevoice-recognizer';

describe('languageOf', () => {
  it.each([
    ['<|ja|>', 'ja'],
    ['<|ko|>', 'ko'],
    ['<|yue|>', 'yue'],
  ])('takes the code of the language SenseVoice names as %s', (lang, code) => {
    expect(languageOf(lang)).toBe(code);
  });

  it.each([['<|nospeech|>'], [''], ['ja']])('is null for %j, which names no language as SenseVoice does', (lang) => {
    expect(languageOf(lang)).toBeNull();
  });
});
