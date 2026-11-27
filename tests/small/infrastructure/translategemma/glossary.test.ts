import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { Glossary, GlossaryMalformed } from '../../../../src/infrastructure/translategemma/glossary';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const EN = LanguageCode.of('en');

const glossary = (...lines: string[]) => Glossary.parse(lines.join('\n'), [JA, KO]);

describe('Glossary', () => {
  describe('parse', () => {
    it('reads a term a line, skipping notes and empty lines', () => {
      expect(glossary('# heroes', 'マーシー\t메르시|메르', '', 'ウルト|ult\t궁|궁극기').size).toBe(2);
    });

    it('takes lines ended by CR LF, and spaces around the ways a term is written', () => {
      const terms = Glossary.parse('マーシー | マシ\t 메르시 \r\nアナ\t아나\r\n', [JA, KO]);

      expect(terms.size).toBe(2);
      expect(terms.termsIn('マシ来て', JA, KO)).toEqual([{ said: 'マシ', translation: '메르시' }]);
    });

    it.each([
      ['one column', 'マーシー'],
      ['three columns', 'マーシー\t메르시\tMercy'],
      ['an empty column', 'マーシー\t'],
      ['a column of separators alone', 'マーシー\t|'],
    ])('refuses a line of %s, naming it by its number', (_case, line) => {
      expect(() => glossary('# heroes', line)).toThrow(new GlossaryMalformed('Line 2 of the glossary is not two columns of terms separated by a tab'));
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
