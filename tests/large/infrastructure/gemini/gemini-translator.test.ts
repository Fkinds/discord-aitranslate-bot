import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { DEFAULT_GEMINI_MODEL } from '../../../../src/infrastructure/config';
import { DISCORD_SAMPLE_RATE_HZ, toSpeechAudio } from '../../../../src/infrastructure/discord/speech-conversion';
import { translatorFor } from '../../../../src/main';
import { FakeLogger } from '../../../support/fakes/fake-logger';

/** "私たちは岩田さんの車でいきました。": "We went in Mr. Iwata's car." See tests/large/fixtures/README.md. */
const RECORDING = path.join(__dirname, '../../fixtures/ja-iwata-san-no-kuruma.wav');

/** A translation may take 3 attempts of 15 s each, and 3 s of waits between them. */
const TRANSLATION_TIMEOUT_MS = 60_000;

const JA = LanguageCode.of('ja');
const EN = LanguageCode.of('en');

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
      expect(format).toEqual(expected);
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

// The translator as main.ts builds it, against the real Gemini API.
describe('Gemini translation, against the Gemini API', () => {
  it('hears Japanese, and translates what was said into English', async () => {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Set GOOGLE_GEMINI_API_KEY to run the large tests');
    const translator = translatorFor({ kind: 'gemini', apiKey, model: DEFAULT_GEMINI_MODEL }, new FakeLogger());
    const speech = toSpeechAudio(asDiscordStereo(monoSamplesOf(readFileSync(RECORDING))));

    const translation = await translator.translate(speech, TranslationLanguages.of(JA, EN));

    const textIn = (language: LanguageCode) => translation.translations.find((t) => t.language.equals(language))?.text;
    expect(translation.spokenLanguage?.tag).toBe('ja');
    expect(translation.original.trim()).not.toBe('');
    expect(textIn(JA)?.trim()).toBeTruthy();
    expect(textIn(EN)).toMatch(/\bcars?\b/i);
  }, TRANSLATION_TIMEOUT_MS);
});
