import { describe, it, expect, beforeAll } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { WhisperRecognizer } from '../../../../src/infrastructure/local/whisper-recognizer';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { LOCAL_MODEL_TIMEOUT_MS, localModelsDir } from '../../../support/local-models';
import { recordedSpeech } from '../../../support/recording';

/** Seconds of 16-bit PCM at 16 kHz, each sample made by `sample`. */
function pcm(seconds: number, sample: (index: number) => number): Uint8Array {
  const bytes = Buffer.alloc(Math.round(seconds * SpeechAudio.SAMPLE_RATE_HZ) * 2);
  for (let i = 0; i < bytes.length / 2; i++) bytes.writeInt16LE(sample(i), i * 2);
  return bytes;
}

/** The speech played `times` as fast, by linear interpolation, so its pitch rises too. */
function fasterBy(times: number, speech: SpeechAudio): SpeechAudio {
  const samples = speech.pcm.byteLength / 2;
  const at = (i: number) => Buffer.from(speech.pcm.buffer, speech.pcm.byteOffset, speech.pcm.byteLength).readInt16LE(i * 2);
  return SpeechAudio.fromPcm(
    pcm(samples / times / SpeechAudio.SAMPLE_RATE_HZ, (i) => {
      const position = i * times;
      const before = Math.min(Math.floor(position), samples - 1);
      const after = Math.min(before + 1, samples - 1);
      return Math.round(at(before) + (at(after) - at(before)) * (position - before));
    })
  );
}

/** Noise that is the same on every run: a linear congruential generator, not Math.random. */
function noise(seconds: number): Uint8Array {
  let state = 1;
  return pcm(seconds, () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return Math.round((state / 2 ** 31 - 0.5) * 6_000);
  });
}

// Silero VAD and Whisper large-v3-turbo, from the models pnpm models:download puts in models/.
describe('WhisperRecognizer, with the local models', () => {
  let recognizer: WhisperRecognizer;

  beforeAll(async () => {
    recognizer = await WhisperRecognizer.load(localModelsDir(), { threads: 4 });
  }, LOCAL_MODEL_TIMEOUT_MS);

  it(
    'hears what was said in Japanese, and that it was Japanese',
    async () => {
      const audio = recordedSpeech();
      const heard = await recognizer.recognize(audio);

      expect(heard.language).toBe('ja');
      expect(heard.text).toMatch(/岩田さんの車/);
      // The speech found is the recording, but for the silence around it.
      expect(heard.stretches).toBeGreaterThan(0);
      expect(heard.speechMs).toBeGreaterThan(0);
      expect(heard.speechMs).toBeLessThanOrEqual(audio.durationMs);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'tells the language among the ones it is given alone',
    async () => {
      const [ja, ko, en] = ['ja', 'ko', 'en'].map((tag) => LanguageCode.of(tag)) as [LanguageCode, LanguageCode, LanguageCode];

      expect((await recognizer.recognize(recordedSpeech(), [ja, ko])).language).toBe('ja');
      expect(['ko', 'en']).toContain((await recognizer.recognize(recordedSpeech(), [ko, en])).language);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'hears the whole of what was said quickly, past the 6 tokens a second sherpa-onnx stops at by default',
    async () => {
      const heard = await recognizer.recognize(fasterBy(1.6, recordedSpeech()));

      expect(heard.text).toMatch(/岩田さんの車で.*(いきました|行きました)/);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'hears each stretch of speech in a long utterance',
    async () => {
      const speech = recordedSpeech().pcm;
      const pause = pcm(1, () => 0);

      const heard = await recognizer.recognize(SpeechAudio.fromPcm(Buffer.concat([speech, pause, speech])));

      expect(heard.language).toBe('ja');
      expect(heard.text).toMatch(/岩田さんの車.* .*岩田さんの車/);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it.each([
    ['silence', SpeechAudio.fromPcm(pcm(2, () => 0))],
    ['noise', SpeechAudio.fromPcm(noise(2))],
    ['no audio at all', SpeechAudio.fromPcm(new Uint8Array(0))],
  ])(
    'hears nothing in %s',
    async (_case, audio) => {
      expect(await recognizer.recognize(audio)).toEqual({ text: '', language: null, speechMs: 0, stretches: 0 });
    },
    LOCAL_MODEL_TIMEOUT_MS
  );
});
