import { describe, it, expect } from '@jest/globals';
import { recordingNameFor } from '../../../../src/infrastructure/discord/speech-recorder';
import { recordingIn, sentencesIn, takesOf, type Recording } from '../../../../src/infrastructure/evaluation/recordings';

/** A recording from `start` to `end` seconds after 14:25:00. */
const recording = (start: number, end: number): Recording => ({
  file: `${start}.wav`,
  startedAt: new Date(Date.UTC(2026, 10, 26, 14, 25, 0) + start * 1000),
  endedAt: new Date(Date.UTC(2026, 10, 26, 14, 25, 0) + end * 1000),
});

describe('recordingIn', () => {
  it('reads when an utterance started and ended from the name the recorder gave it', () => {
    const startedAt = new Date('2026-11-26T14:25:00.123Z');
    const endedAt = new Date('2026-11-26T14:25:02.456Z');

    expect(recordingIn('/r/a.wav', recordingNameFor(startedAt, endedAt))).toEqual({ file: '/r/a.wav', startedAt, endedAt });
  });

  it.each(['sentences.tsv', 'notes.wav', '20261126T142500Z-20261126T142502Z.wav'])('is undefined for any other name: %s', (name) => {
    expect(recordingIn(`/r/${name}`, name)).toBeUndefined();
  });
});

describe('takesOf', () => {
  it('puts the utterances of a sentence cut by short pauses in one take, and starts a take after a long pause', () => {
    const takes = takesOf([recording(0, 1.2), recording(1.5, 2.5), recording(5, 6.5), recording(9, 10)], 1_500);

    expect(takes.map((take) => take.map(({ file }) => file))).toEqual([['0.wav', '1.5.wav'], ['5.wav'], ['9.wav']]);
  });

  it('goes by when the utterances started, whatever order they come in', () => {
    const takes = takesOf([recording(5, 6), recording(0, 1)], 1_500);

    expect(takes.map((take) => take.map(({ file }) => file))).toEqual([['0.wav'], ['5.wav']]);
  });

  it('makes no takes of no recordings', () => {
    expect(takesOf([], 1_500)).toEqual([]);
  });
});

describe('sentencesIn', () => {
  it('reads one sentence a line, its language and its text separated by a tab, skipping blanks and comments', () => {
    expect(sentencesIn('# Japanese\nja\tちょっと待って\n\nko\t지금 갈게 \r\n')).toEqual([
      { language: 'ja', text: 'ちょっと待って' },
      { language: 'ko', text: '지금 갈게' },
    ]);
  });

  it('refuses a line with no tab, saying which', () => {
    expect(() => sentencesIn('ja\tはい\nko 네')).toThrow('Sentence 2 has no tab between its language and its text: ko 네');
  });
});
