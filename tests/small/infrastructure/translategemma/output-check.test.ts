import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { problemsOf, unquoted } from '../../../../src/infrastructure/translategemma/output-check';

const [JA, KO, ZH, EN, FR, RU] = ['ja', 'ko', 'zh', 'en', 'fr', 'ru'].map((tag) => LanguageCode.of(tag)) as [
  LanguageCode,
  LanguageCode,
  LanguageCode,
  LanguageCode,
  LanguageCode,
  LanguageCode,
];

describe('problemsOf', () => {
  // Translations the 12B model made in the trial (#86).
  it.each([
    ['Japanese into Korean', '明日って何時集合だっけ', '내일 몇 시에 모이기로 했지?', JA, KO],
    ['Korean into Japanese', '나 배고파 뭐 시켜 먹을까', 'お腹すいた、何か頼んで食べようか', KO, JA],
    ['English into Japanese', 'brb grabbing a snack', 'ちょっとお菓子取ってくるね', EN, JA],
  ])('finds nothing wrong in a good translation from %s', (_, source, translation, from, into) => {
    expect(problemsOf(source, translation, from, into)).toEqual([]);
  });

  it('finds a translation of only whitespace empty', () => {
    expect(problemsOf('はい', '  ', JA, KO)).toEqual(['empty']);
  });

  it.each([
    ['kana in Korean', '佐々木くんが来るなら俺も行こうかな', '사사키 くん이 오면 나도 갈까', JA, KO],
    ['kanji in Korean', '山本部長は本日お休みです', '山本 부장님은 오늘 휴가입니다', JA, KO],
    ['hangul in Japanese', '그거 완전 대박이다 진짜', 'それマジで대박だよ', KO, JA],
    ['kana in Chinese', 'ちょっと待って', '等一下ちょっと', JA, ZH],
    ['hangul in Chinese', '안녕하세요', '你好안녕', KO, ZH],
    ['hanzi in Korean', '你好', '안녕 你好', ZH, KO],
    ['kana in English', 'ありがとう', 'Thank you ありがとう', JA, EN],
    ['Cyrillic in French', 'Привет', 'Bonjour Привет', RU, FR],
  ])('finds letters of the source left in the translation: %s', (_, source, translation, from, into) => {
    expect(problemsOf(source, translation, from, into)).toEqual(['other-script']);
  });

  it.each([
    ['hanzi kept in Japanese from Chinese', '你好', '你好', ZH, JA],
    ['kanji kept in Chinese from Japanese', '東京', '东京', JA, ZH],
    ['Latin kept in Japanese from English', 'Sato pushed the release to Friday', 'Satoがリリースを金曜に延ばした', EN, JA],
    ['Latin kept in Korean from Japanese', 'それマジでGGだわ', '그거 진짜 GG다', JA, KO],
    ['Latin kept in French from English', 'see you', 'à plus', EN, FR],
  ])('does not count a script both languages are written in, or the Latin script: %s', (_, source, translation, from, into) => {
    expect(problemsOf(source, translation, from, into)).toEqual([]);
  });

  it.each([
    ['()', '정말 대단하다. (혹은) 진짜 최고다.'],
    ['（）', '本当にすごい（または最高）'],
  ])('finds parentheses %s the source has not', (_, translation) => {
    expect(problemsOf('すごい', translation, JA, KO)).toContain('added-parenthesis');
  });

  it('keeps parentheses the source has', () => {
    expect(problemsOf('(笑)', '(웃음)', JA, KO)).toEqual([]);
  });

  it('finds a line break the source has not, and keeps one it has', () => {
    expect(problemsOf('うん', '응\n네', JA, KO)).toEqual(['added-line-break']);
    expect(problemsOf('うん\nはい', '응\n네', JA, KO)).toEqual([]);
  });

  it('finds a translation longer than three times the source and 20 characters, counting code points', () => {
    const source = 'はい'; // 2 characters: at most 26
    expect(problemsOf(source, '네'.repeat(26), JA, KO)).toEqual([]);
    expect(problemsOf(source, '네'.repeat(27), JA, KO)).toEqual(['too-long']);
    expect(problemsOf('👍👍', 'a'.repeat(27), EN, FR)).toEqual(['too-long']); // 4 UTF-16 code units, but 2 characters
  });

  it('finds every problem there is, in order', () => {
    expect(problemsOf('うん', `응 (うん)\n${'네'.repeat(30)}`, JA, KO)).toEqual([
      'other-script',
      'added-parenthesis',
      'added-line-break',
      'too-long',
    ]);
  });
});

describe('unquoted', () => {
  it.each([
    ['"OK"', 'OK'],
    ["'OK'", 'OK'],
    ['“좋아”', '좋아'],
    ['‘좋아’', '좋아'],
    ['「いいよ」', 'いいよ'],
    ['『いいよ』', 'いいよ'],
    ['«d’accord»', 'd’accord'],
    ['„gut“', 'gut'],
    ['  " 좋아 "  ', '좋아'],
  ])('takes off the quotation marks the whole of %s is wrapped in', (translation, expected) => {
    expect(unquoted(translation)).toBe(expected);
  });

  it.each([
    ['"yes" or "no"', '"yes" or "no"'],
    ['「はい」か「いいえ」', '「はい」か「いいえ」'],
    ['"좋아」', '"좋아」'],
    ['"', '"'],
    ['좋아 "진짜"', '좋아 "진짜"'],
  ])('keeps quotation marks that do not wrap the whole of %s', (translation, expected) => {
    expect(unquoted(translation)).toBe(expected);
  });

  it('trims a translation that is not quoted', () => {
    expect(unquoted('  좋아\n')).toBe('좋아');
  });
});
