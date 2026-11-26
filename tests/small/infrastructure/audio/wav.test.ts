import { describe, it, expect } from '@jest/globals';
import { fromWav, toWav } from '../../../../src/infrastructure/audio/wav';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';

describe('toWav', () => {
  const samples = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  const wav = toWav(SpeechAudio.fromPcm(samples));

  it('writes a RIFF WAVE header for 16-bit mono PCM at 16 kHz', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + samples.length);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1); // linear PCM
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16_000); // samples per second
    expect(wav.readUInt32LE(28)).toBe(32_000); // bytes per second
    expect(wav.readUInt16LE(32)).toBe(2); // bytes per sample frame
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample

    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(samples.length);
  });

  it('puts the samples after the header, unchanged', () => {
    expect(wav.length).toBe(44 + samples.length);
    expect([...wav.subarray(44)]).toEqual([...samples]);
  });
});

describe('fromWav', () => {
  const speech = SpeechAudio.fromPcm(Uint8Array.from([0x01, 0x02, 0x03, 0x04]));

  it('reads back the speech toWav wrote', () => {
    expect([...fromWav(toWav(speech)).pcm]).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it('skips a chunk other than "fmt " and "data"', () => {
    const wav = toWav(speech);
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc'), Buffer.from([0])]);
    const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);

    expect([...fromWav(withList).pcm]).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it('refuses another format, saying what it got', () => {
    const stereo = toWav(speech);
    stereo.writeUInt16LE(2, 22);

    expect(() => fromWav(stereo)).toThrow('got 1,2,16000,16');
  });

  it('refuses what is not a WAVE file', () => {
    expect(() => fromWav(Buffer.from('not a WAVE file at all'))).toThrow('Not a WAVE file');
  });
});
