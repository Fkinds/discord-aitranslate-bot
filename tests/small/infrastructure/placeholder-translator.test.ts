import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../src/domain/language-code';
import { PlaceholderTranslator } from '../../../src/infrastructure/placeholder-translator';
import { SpeechAudio } from '../../../src/usecases/ports/speech-audio';

describe('PlaceholderTranslator', () => {
  it('says how long the speech was and what it would be translated into', async () => {
    const twoAndAHalfSeconds = SpeechAudio.fromPcm(new Uint8Array(80_000));

    const translation = await new PlaceholderTranslator().translate(twoAndAHalfSeconds, LanguageCode.of('ja'));

    expect(translation).toEqual({
      original: '(2.5 s of speech)',
      translated: '(2.5 s of speech, not translated into Japanese (日本語): TRANSLATOR=fake)',
      detectedLanguage: 'und',
    });
  });
});
