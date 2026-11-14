import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DISCORD_SAMPLE_RATE_HZ, toSpeechAudio } from '../../src/infrastructure/discord/speech-conversion';
import type { SpeechAudio } from '../../src/usecases/ports/speech-audio';

/** "私たちは岩田さんの車でいきました。": "We went in Mr. Iwata's car." See tests/fixtures/README.md. */
export const RECORDING = path.join(__dirname, '../fixtures/ja-iwata-san-no-kuruma.wav');

/** The recording as the voice receiver hands speech to the translator: converted by the bot itself. */
export function recordedSpeech(): SpeechAudio {
  return toSpeechAudio(asDiscordStereo(monoSamplesOf(readFileSync(RECORDING))));
}

/** The samples of a WAVE file of 16-bit PCM, mono, at Discord's 48 kHz; it fails on any other format. */
function monoSamplesOf(wav: Buffer): Buffer {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file');
  let format: { pcm: boolean; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        pcm: wav.readUInt16LE(body) === 1,
        channels: wav.readUInt16LE(body + 2),
        sampleRate: wav.readUInt32LE(body + 4),
        bitsPerSample: wav.readUInt16LE(body + 14),
      };
    }
    if (id === 'data') {
      const expected = { pcm: true, channels: 1, sampleRate: DISCORD_SAMPLE_RATE_HZ, bitsPerSample: 16 };
      if (JSON.stringify(format) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(format)}`);
      }
      return wav.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  throw new Error('No data chunk');
}

/** Mono samples as Discord sends speech: in stereo, each sample in both channels. */
function asDiscordStereo(mono: Buffer): Buffer {
  const stereo = Buffer.alloc(mono.length * 2);
  for (let i = 0; i < mono.length; i += 2) {
    const sample = mono.readInt16LE(i);
    stereo.writeInt16LE(sample, i * 2);
    stereo.writeInt16LE(sample, i * 2 + 2);
  }
  return stereo;
}
