import { describe, it, expect } from '@jest/globals';
import {
  characterErrorRate,
  comparable,
  editDistance,
  errorsIn,
} from '../../../../src/infrastructure/evaluation/character-error-rate';

describe('comparable', () => {
  it('leaves out white space, punctuation and symbols, and folds width and case', () => {
    expect(comparable('ちょっと待って、今トイレ！ ＯＫ?').join('')).toBe('ちょっと待って今トイレok');
    expect(comparable('지금 갈게. 지금').join('')).toBe('지금갈게지금');
  });
});

describe('editDistance', () => {
  it.each([
    [[], [], 0],
    [['a', 'b', 'c'], ['a', 'b', 'c'], 0],
    [['a', 'b', 'c'], ['a', 'c'], 1],
    [['a', 'b'], ['a', 'x', 'b'], 1],
    [['k', 'i', 't', 't', 'e', 'n'], ['s', 'i', 't', 't', 'i', 'n', 'g'], 3],
  ])('counts the fewest edits from %j to %j', (said, heard, edits) => {
    expect(editDistance(said, heard)).toBe(edits);
  });
});

describe('errorsIn', () => {
  it('counts the characters to change in what was heard, against the characters said', () => {
    // From #98: "고마워" heard as "こまわ".
    expect(errorsIn('고마워', 'こまわ')).toEqual({ edits: 3, characters: 3 });
    // A Japanese sentence cut short.
    expect(errorsIn('私たちは岩田さんの車でいきました。', '私たちは岩田さんの車で行')).toEqual({ edits: 5, characters: 16 });
  });

  it('counts a heard sentence with other punctuation and spaces as right', () => {
    expect(errorsIn('민수야 지금 어디야', '민수야, 지금 어디야?')).toEqual({ edits: 0, characters: 8 });
  });
});

describe('characterErrorRate', () => {
  it('weighs each sentence by its characters', () => {
    expect(characterErrorRate([{ edits: 1, characters: 4 }, { edits: 0, characters: 16 }])).toBe(0.05);
  });

  it('is 0 when nothing was said', () => {
    expect(characterErrorRate([])).toBe(0);
  });
});
