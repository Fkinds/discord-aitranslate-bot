import { describe, it, expect, jest } from '@jest/globals';
import { toSpeechAudio } from '../../../../src/infrastructure/discord/speech-conversion';
import { AudioProcessor } from '../../../../src/voice/audio-processor';
import { createMockLogger } from '../../../helpers/mocks';

/** 48 kHz stereo PCM from [left, right] frames. */
function stereo(...frames: Array<[number, number]>): Buffer {
  const pcm = Buffer.alloc(frames.length * 4);
  frames.forEach(([left, right], i) => {
    pcm.writeInt16LE(left, i * 4);
    pcm.writeInt16LE(right, i * 4 + 2);
  });
  return pcm;
}

function samples(pcm: Uint8Array): number[] {
  const buffer = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Array.from({ length: buffer.length / 2 }, (_, i) => buffer.readInt16LE(i * 2));
}

describe('toSpeechAudio', () => {
  it('keeps every third frame, mixed down to the average of its channels rounded down', () => {
    const pcm = stereo([100, 200], [9, 9], [9, 9], [-3, 0], [9, 9], [9, 9], [32767, 32767], [9, 9], [9, 9]);

    expect(samples(toSpeechAudio(pcm).pcm)).toEqual([150, -2, 32767]);
  });

  it('drops a trailing part of a frame', () => {
    const pcm = Buffer.concat([stereo([10, 20], [0, 0], [0, 0]), Buffer.from([1, 2, 3])]);

    expect(samples(toSpeechAudio(pcm).pcm)).toEqual([15]);
  });

  it('turns no audio into empty speech', () => {
    expect(toSpeechAudio(Buffer.alloc(0)).isEmpty).toBe(true);
  });

  // Removed together with src/voice in CA-8.
  it('gives the same samples as the old AudioProcessor.resample', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    let seed = 42;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31);
    const frames = Array.from({ length: 4801 }, (): [number, number] => [(next() % 65_536) - 32_768, (next() % 65_536) - 32_768]);
    const pcm = stereo(...frames);

    const old = await new AudioProcessor(createMockLogger()).resample(pcm, 48_000, 16_000);

    expect(samples(toSpeechAudio(pcm).pcm)).toEqual(samples(old));
  });
});
