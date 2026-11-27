import { describe, it, expect } from '@jest/globals';
import { type Hearing, summariesOf } from '../../../../src/infrastructure/evaluation/speech-summary';

const hearing = (overrides: Partial<Hearing>): Hearing => ({
  language: 'ja',
  said: 'ちょっと待って',
  heard: 'ちょっと待って',
  heardLanguage: 'ja',
  speechMs: 2_000,
  ms: 200,
  ...overrides,
});

describe('summariesOf', () => {
  it('sums up each language apart, in the order the languages first come', () => {
    const summaries = summariesOf([
      hearing({ language: 'ko', said: '잠깐만', heard: '잠깐만', heardLanguage: 'ko' }),
      hearing({}),
      hearing({ language: 'ko', said: '네', heard: '', heardLanguage: null }),
    ]);

    expect(summaries.map(({ language, sentences }) => [language, sentences])).toEqual([
      ['ko', 2],
      ['ja', 1],
    ]);
  });

  it('gives the character error rate, the share with nothing written, and the share heard in the right language', () => {
    const [summary] = summariesOf([
      hearing({ said: 'はい', heard: 'はい' }),
      hearing({ said: 'うん', heard: 'うむ' }),
      hearing({ said: 'ええ', heard: '', heardLanguage: null }),
      hearing({ said: 'そう', heard: 'そう', heardLanguage: 'zh' }),
    ]);

    expect(summary?.characterErrorRate).toBe(3 / 8);
    expect(summary?.nothingWritten).toBe(1 / 4);
    expect(summary?.rightLanguage).toBe(2 / 4);
  });

  it('gives how long hearing a second of speech took', () => {
    const [summary] = summariesOf([hearing({ speechMs: 3_000, ms: 300 }), hearing({ speechMs: 1_000, ms: 500 })]);

    expect(summary?.msPerSecond).toBe(200);
  });

  it('gives no time for no speech', () => {
    expect(summariesOf([hearing({ speechMs: 0, ms: 10 })])[0]?.msPerSecond).toBe(0);
  });
});
