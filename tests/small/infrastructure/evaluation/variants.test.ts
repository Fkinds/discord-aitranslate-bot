import { describe, it, expect } from '@jest/globals';
import { allTheSame, variantName, variantsOf } from '../../../../src/infrastructure/evaluation/variants';

describe('variantsOf', () => {
  const models = ['translategemma:12b', 'gemma4:12b-it-qat', 'translategemma:12b-it-q8_0'];

  it('compares each model as the bot asks it, without a glossary', () => {
    expect(variantsOf(models, false).map(variantName)).toEqual(models);
  });

  it('adds each TranslateGemma model with the glossary right after it, and no other', () => {
    expect(variantsOf(models, true).map(variantName)).toEqual([
      'translategemma:12b',
      'translategemma:12b + glossary',
      'gemma4:12b-it-qat',
      'translategemma:12b-it-q8_0',
      'translategemma:12b-it-q8_0 + glossary',
    ]);
  });
});

describe('allTheSame', () => {
  it.each([
    ['the same', ['메르시', '메르시'], true],
    ['different', ['메르시', '메르시 궁'], false],
    ['one alone, with nothing to tell it from', ['메르시'], false],
    ['none', [], false],
  ])('is %s for translations that are %s', (_case, texts, expected) => {
    expect(allTheSame(texts)).toBe(expected);
  });
});
