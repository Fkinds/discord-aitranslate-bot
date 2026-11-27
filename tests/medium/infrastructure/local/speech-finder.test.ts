import { describe, it, expect, beforeAll } from '@jest/globals';
import { MAX_STRETCH_SECONDS, samplesOf, SpeechFinder, WHISPER_MAX_SECONDS } from '../../../../src/infrastructure/local/speech-finder';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { localModelsDir } from '../../../support/local-models';
import { recordedSpeech } from '../../../support/recording';

// Silero VAD from the local models, on the recording of the fixtures.
describe('SpeechFinder', () => {
  let finder: SpeechFinder;

  beforeAll(() => {
    finder = SpeechFinder.load(localModelsDir());
  });

  it('finds the speech in a recording, no longer than the recording', () => {
    const samples = samplesOf(recordedSpeech());

    const stretches = finder.stretchesIn(samples);

    expect(stretches.length).toBeGreaterThan(0);
    expect(stretches.reduce((sum, stretch) => sum + stretch.length, 0)).toBeLessThanOrEqual(samples.length);
  });

  it(`cuts speech without a pause, longer than ${MAX_STRETCH_SECONDS} s, into stretches Whisper can take`, () => {
    const once = samplesOf(recordedSpeech());
    const times = Math.ceil(((MAX_STRETCH_SECONDS + 5) * SpeechAudio.SAMPLE_RATE_HZ) / once.length);
    const long = new Float32Array(once.length * times);
    for (let i = 0; i < times; i++) long.set(once, i * once.length);

    const stretches = finder.stretchesIn(long);

    expect(stretches.length).toBeGreaterThan(1);
    expect(stretches.every((stretch) => stretch.length <= WHISPER_MAX_SECONDS * SpeechAudio.SAMPLE_RATE_HZ)).toBe(true);
  });

  it('finds no speech in silence', () => {
    expect(finder.stretchesIn(new Float32Array(2 * SpeechAudio.SAMPLE_RATE_HZ))).toEqual([]);
  });
});
