import { describe, it, expect } from '@jest/globals';
import { samplesOf } from '../../../../src/infrastructure/local/speech-finder';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';

describe('samplesOf', () => {
  it('reads 16-bit little-endian samples as numbers from -1 to 1', () => {
    const pcm = Buffer.alloc(8);
    [0, 16_384, 32_767, -32_768].forEach((sample, i) => pcm.writeInt16LE(sample, i * 2));

    expect(Array.from(samplesOf(SpeechAudio.fromPcm(pcm)))).toEqual([0, 0.5, 32_767 / 32_768, -1]);
  });

  it('reads samples that do not start on an even byte of their buffer', () => {
    const pcm = Buffer.alloc(5);
    pcm.writeInt16LE(-16_384, 1);
    pcm.writeInt16LE(16_384, 3);

    expect(Array.from(samplesOf(SpeechAudio.fromPcm(pcm.subarray(1))))).toEqual([-0.5, 0.5]);
  });
});
