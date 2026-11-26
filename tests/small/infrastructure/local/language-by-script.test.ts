import { describe, it, expect } from '@jest/globals';
import { languageByScript } from '../../../../src/infrastructure/local/language-by-script';

describe('languageByScript', () => {
  it.each([
    ['hangul Whisper took for Japanese', '고마워', 'ja', 'ko'],
    ['hangul Whisper took for Chinese', '지금 갈게', 'zh', 'ko'],
    ['kana Whisper took for Korean', 'こまわ', 'ko', 'ja'],
    ['katakana Whisper took for English', 'エイ', 'en', 'ja'],
    ['kana and kanji Whisper took for Chinese', '明日って何時集合だっけ', 'zh', 'ja'],
  ])('corrects the language by the letters: %s', (_, text, heard, expected) => {
    expect(languageByScript(text, heard)).toBe(expected);
  });

  it.each([
    ['kanji alone, which may be Japanese or Chinese', '東京', 'zh'],
    ['Latin letters', 'OK', 'en'],
    ['a language Whisper heard right', '안녕하세요', 'ko'],
    ['nothing in either script', '...', 'vi'],
  ])('keeps the language Whisper heard for %s', (_, text, heard) => {
    expect(languageByScript(text, heard)).toBe(heard);
  });

  it('goes by the script there is more of, when there are both', () => {
    expect(languageByScript('오늘 ゲーム 몇 시야?', 'ja')).toBe('ko');
    expect(languageByScript('今日 김 さんと話した', 'ko')).toBe('ja');
  });

  it('keeps the language Whisper heard when there is as much of each, or when it heard none', () => {
    expect(languageByScript('가あ', 'zh')).toBe('zh');
    expect(languageByScript('', null)).toBeNull();
  });
});
