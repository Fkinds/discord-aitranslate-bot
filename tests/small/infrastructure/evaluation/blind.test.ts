import { describe, it, expect } from '@jest/globals';
import { blindOrder } from '../../../../src/infrastructure/evaluation/blind';

describe('blindOrder', () => {
  it('puts each thing in once', () => {
    for (let seed = 0; seed < 50; seed++) expect([...blindOrder(3, seed)].sort()).toEqual([0, 1, 2]);
  });

  it('shuffles the same way for the same seed', () => {
    expect(blindOrder(5, 42)).toEqual(blindOrder(5, 42));
  });

  it('does not always put the things in the same place', () => {
    const firsts = new Set(Array.from({ length: 30 }, (_, seed) => blindOrder(3, seed)[0]));

    expect(firsts.size).toBe(3);
  });

  it('shows none or one thing as it is', () => {
    expect(blindOrder(0, 1)).toEqual([]);
    expect(blindOrder(1, 1)).toEqual([0]);
  });
});
