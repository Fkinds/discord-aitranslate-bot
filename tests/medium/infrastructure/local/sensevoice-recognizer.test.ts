import { describe, it, expect, beforeAll } from '@jest/globals';
import { SenseVoiceRecognizer } from '../../../../src/infrastructure/local/sensevoice-recognizer';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { candidateModelsDir, LOCAL_MODEL_TIMEOUT_MS } from '../../../support/local-models';
import { recordedSpeech } from '../../../support/recording';

// SenseVoice-Small from the candidate models, on the recording of the fixtures.
describe('SenseVoiceRecognizer', () => {
  let recognizer: SenseVoiceRecognizer;

  beforeAll(async () => {
    recognizer = await SenseVoiceRecognizer.load(candidateModelsDir(), { threads: 4 });
  }, LOCAL_MODEL_TIMEOUT_MS);

  it(
    'hears what was said in Japanese, and that it was Japanese, and the speech it was in',
    async () => {
      const audio = recordedSpeech();

      const heard = await recognizer.recognize(audio);

      expect(heard.language).toBe('ja');
      expect(heard.text).toMatch(/岩田さんの車/);
      expect(heard.stretches).toBeGreaterThan(0);
      expect(heard.speechMs).toBeLessThanOrEqual(audio.durationMs);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it.each([
    ['silence', SpeechAudio.fromPcm(new Uint8Array(2 * 32_000))],
    ['no audio at all', SpeechAudio.fromPcm(new Uint8Array(0))],
  ])(
    'hears nothing in %s',
    async (_case, audio) => {
      expect(await recognizer.recognize(audio)).toEqual({ text: '', language: null, speechMs: 0, stretches: 0 });
    },
    LOCAL_MODEL_TIMEOUT_MS
  );
});
