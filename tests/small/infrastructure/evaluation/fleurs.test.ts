import { describe, it, expect } from '@jest/globals';
import { fleursUtterances, sampleOf, speechFromFloatWav } from '../../../../src/infrastructure/evaluation/fleurs';

describe('fleursUtterances', () => {
  it('reads the id, the file name and the transcription as written, of each line', () => {
    const tsv = '1743\t178.wav\t技術決定論の解釈は、2つあります。\t技術決定論の解釈は 2つあります\tchars\t171840\tMALE\n';

    expect(fleursUtterances(tsv)).toEqual([{ id: '1743', file: '178.wav', text: '技術決定論の解釈は、2つあります。' }]);
  });

  it('reads a transcription written in quotes, as CSV writes one that holds quotes', () => {
    const tsv = '1699\t139.wav\t"비슈케크가 ""무정부""상태로 빠지고 있다고 묘사하였습니다."\t"x\n';

    expect(fleursUtterances(tsv)[0]?.text).toBe('비슈케크가 "무정부"상태로 빠지고 있다고 묘사하였습니다.');
  });

  it('refuses a line of fewer than three columns', () => {
    expect(() => fleursUtterances('1\t1.wav\t文\n2\t2.wav\n')).toThrow('Line 2 of the FLEURS transcript has fewer than three columns');
  });
});

describe('sampleOf', () => {
  const utterance = (id: string, file: string) => ({ id, file, text: id });

  it('takes the first utterances of different sentences, in the order they come', () => {
    const utterances = [utterance('1', 'a.wav'), utterance('1', 'b.wav'), utterance('2', 'c.wav'), utterance('3', 'd.wav')];

    expect(sampleOf(utterances, 2).map(({ file }) => file)).toEqual(['a.wav', 'c.wav']);
    expect(sampleOf(utterances, 10).map(({ file }) => file)).toEqual(['a.wav', 'c.wav', 'd.wav']);
  });
});

/** A WAVE file of these samples, as FLEURS writes them: 32-bit float, mono, 16 kHz. */
function floatWav(samples: readonly number[], { format = 3, rate = 16_000 } = {}): Buffer {
  const data = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, i) => data.writeFloatLE(sample, i * 4));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(format, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * 4, 8);
  fmt.writeUInt16LE(4, 12);
  fmt.writeUInt16LE(32, 14);
  const chunk = (id: string, body: Buffer) => Buffer.concat([Buffer.from(id, 'ascii'), Buffer.from(Uint32Array.of(body.length).buffer), body]);
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), chunk('fmt ', fmt), chunk('data', data)]);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from(Uint32Array.of(body.length).buffer), body]);
}

describe('speechFromFloatWav', () => {
  it('turns 32-bit float samples into 16-bit ones, rounded, and clipped to their range', () => {
    const speech = speechFromFloatWav(floatWav([0, 0.5, -0.5, 1, -1, 1.5, -1.5]));
    const pcm = Buffer.from(speech.pcm.buffer, speech.pcm.byteOffset, speech.pcm.byteLength);

    expect(Array.from({ length: 7 }, (_, i) => pcm.readInt16LE(i * 2))).toEqual([0, 16_384, -16_383, 32_767, -32_767, 32_767, -32_768]);
  });

  it.each([
    ['16-bit linear PCM', { format: 1 }, 'got 1,1,16000,32'],
    ['another rate', { rate: 48_000 }, 'got 3,1,48000,32'],
  ])('refuses %s', (_case, options, got) => {
    expect(() => speechFromFloatWav(floatWav([0], options))).toThrow(got);
  });

  it('refuses what is not a WAVE file', () => {
    expect(() => speechFromFloatWav(Buffer.from('not a WAVE file at all'))).toThrow('Not a WAVE file');
  });
});
