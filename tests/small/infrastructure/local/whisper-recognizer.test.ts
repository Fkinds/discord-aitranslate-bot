import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { samplesOf, spokenLanguageAmong } from '../../../../src/infrastructure/local/whisper-recognizer';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');

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

describe('spokenLanguageAmong', () => {
  const jaKo = TranslationLanguages.of(JA, KO);

  it.each([
    ['ja', JA],
    ['ko', KO],
  ])('takes "%s" for that language of the session', (heard, language) => {
    expect(spokenLanguageAmong(jaKo, heard)).toBe(language);
  });

  it.each([
    ['another language', 'en'],
    ['a variety Whisper tells apart', 'yue'],
    ['no language', null],
  ])('takes %s for none of the session', (_case, heard) => {
    expect(spokenLanguageAmong(jaKo, heard)).toBeNull();
  });

  it('takes the language of a session of one language', () => {
    expect(spokenLanguageAmong(TranslationLanguages.of(JA), 'ja')).toBe(JA);
  });
});
