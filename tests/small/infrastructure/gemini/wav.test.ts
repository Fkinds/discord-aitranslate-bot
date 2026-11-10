import { describe, it, expect } from '@jest/globals';
import { toWav } from '../../../../src/infrastructure/gemini/wav';
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
