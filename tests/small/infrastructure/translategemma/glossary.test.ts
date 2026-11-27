import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { Glossary, GlossaryMalformed } from '../../../../src/infrastructure/translategemma/glossary';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const EN = LanguageCode.of('en');

/** A glossary in Japanese and Korean, of these lines. */
const glossary = (...lines: string[]) => Glossary.parse(['ja\tko', ...lines].join('\n'));

describe('Glossary', () => {
  describe('parse', () => {
    it('reads the languages from the first line, then a term a line, skipping notes and empty lines', () => {
      const terms = Glossary.parse(['# Overwatch', '', 'ja\tko', '# heroes', 'マーシー\t메르시|메르', '', 'ウルト|ult\t궁|궁극기'].join('\n'));

      expect(terms.languages.map((language) => language.tag)).toEqual(['ja', 'ko']);
      expect(terms.size).toBe(2);
    });

    it('reads the columns in the order the first line names their languages', () => {
      const terms = Glossary.parse('ko\tja\n메르시\tマーシー');

      expect(terms.termsIn('マーシー', JA, KO)).toEqual([{ said: 'マーシー', translation: '메르시' }]);
    });

    it('takes lines ended by CR LF, and spaces around the ways a term is written', () => {
      const terms = Glossary.parse('ja\tko\r\nマーシー | マシ\t 메르시 \r\nアナ\t아나\r\n');

      expect(terms.size).toBe(2);
      expect(terms.termsIn('マシ来て', JA, KO)).toEqual([{ said: 'マシ', translation: '메르시' }]);
    });

    it.each([
      ['one column', 'マーシー'],
      ['three columns', 'マーシー\t메르시\tMercy'],
      ['an empty column', 'マーシー\t'],
      ['a column of separators alone', 'マーシー\t|'],
    ])('refuses a line of %s, naming it by its number', (_case, line) => {
      expect(() => glossary('# heroes', line)).toThrow(new GlossaryMalformed('Line 3 of the glossary is not two columns of terms separated by a tab'));
    });

    it.each([
      ['one language', 'ja', 'it has 1 columns'],
      ['three languages', 'ja\tko\ten', 'it has 3 columns'],
      ['one language twice', 'ja\tja', 'it names ja twice'],
      ['what is not a language tag', 'ja\tkorean!', 'LanguageCode must be a well-formed language tag such as "ja" or "zh-TW", got "korean!"'],
      ['a term in place of the languages', 'マーシー\t메르시', 'LanguageCode must be a well-formed language tag such as "ja" or "zh-TW", got "マーシー"'],
    ])('refuses a first line of %s', (_case, line, why) => {
      expect(() => Glossary.parse(`# notes\n${line}\nアナ\t아나`)).toThrow(
        new GlossaryMalformed(`Line 2 of the glossary, its first, must name its two languages by their tags, such as "ja" and "ko": ${why}`)
      );
    });

    it('refuses a glossary with no first line', () => {
      expect(() => Glossary.parse('# notes alone\n\n')).toThrow(
        new GlossaryMalformed('The glossary is empty: its first line must name its two languages')
      );
    });

    it.each([
      ['on two lines', ['マクリー\t맥크리', 'キャスディ\t캐서디|맥크리'], 'Line 3 of the glossary writes "맥크리" as line 2 does: write it on one line only'],
      ['alike but for width and capitals', ['ウルト|ult\t궁', 'ＵＬＴ\t궁극기'], 'Line 3 of the glossary writes "ＵＬＴ" as line 2 does: write it on one line only'],
      ['twice on one line', ['マーシー|マーシー\t메르시'], 'Line 2 of the glossary writes "マーシー" twice'],
    ])('refuses a term written the same %s, naming the lines', (_case, lines, message) => {
      expect(() => glossary(...lines)).toThrow(new GlossaryMalformed(message));
    });

    it('takes a term written the same in both languages', () => {
      expect(glossary('D.Va\tD.Va|디바').termsIn('디바', KO, JA)).toEqual([{ said: '디바', translation: 'D.Va' }]);
    });
  });

  describe('termsIn', () => {
    const terms = glossary('マーシー|マシ\t메르시|메르', 'ウルト|ult\t궁|궁극기', 'ソルジャー\t솔저', 'ソルジャー76\t솔저: 76', '草|w\tㅋㅋ');

    it('finds a term within a longer word, to translate into the first way the other language writes it', () => {
      expect(terms.termsIn('マーシーさんウルトある？', JA, KO)).toEqual([
        { said: 'マーシー', translation: '메르시' },
        { said: 'ウルト', translation: '궁' },
      ]);
    });

    it('finds terms said in the other language, both ways', () => {
      expect(terms.termsIn('메르 궁 있어?', KO, JA)).toEqual([
        { said: '메르', translation: 'マーシー' },
        { said: '궁', translation: 'ウルト' },
      ]);
    });

    it('takes the longest of terms that overlap', () => {
      expect(terms.termsIn('ソルジャー76どこ？', JA, KO)).toEqual([{ said: 'ソルジャー76', translation: '솔저: 76' }]);
    });

    it('finds full-width and half-width letters, and capitals, alike', () => {
      expect(terms.termsIn('ＵＬＴ溜まった、ｿﾙｼﾞｬｰ７６', JA, KO)).toEqual([
        { said: 'ult', translation: '궁' },
        { said: 'ソルジャー76', translation: '솔저: 76' },
      ]);
    });

    it('lists a term once, however often it is said, in the order the terms come', () => {
      expect(terms.termsIn('草、ウルト、草w', JA, KO)).toEqual([
        { said: '草', translation: 'ㅋㅋ' },
        { said: 'ウルト', translation: '궁' },
      ]);
    });

    it('finds nothing in text without its terms', () => {
      expect(terms.termsIn('ちょっと待って', JA, KO)).toEqual([]);
    });

    it('finds nothing for a language it does not have', () => {
      expect(terms.termsIn('マーシー', JA, EN)).toEqual([]);
      expect(terms.termsIn('Mercy', EN, JA)).toEqual([]);
    });
  });
});
