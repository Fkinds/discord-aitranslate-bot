import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../src/domain/language-code';
import { TranslationLanguages } from '../../../src/domain/translation-languages';
import { PlaceholderTranslator } from '../../../src/infrastructure/placeholder-translator';
import { SpeechAudio } from '../../../src/usecases/ports/speech-audio';

describe('PlaceholderTranslator', () => {
  it('says how long the speech was, and what it would be translated into, for each language', async () => {
    const twoAndAHalfSeconds = SpeechAudio.fromPcm(new Uint8Array(80_000));
    const languages = TranslationLanguages.of(LanguageCode.of('ja'), LanguageCode.of('ko'));

    const translation = await new PlaceholderTranslator().translate(twoAndAHalfSeconds, languages);

    expect(translation.original).toBe('(2.5 s of speech)');
    expect(translation.translations.map(({ language, text }) => [language.tag, text])).toEqual([
      ['ja', '(2.5 s of speech, not translated into Japanese (日本語): TRANSLATOR=fake)'],
      ['ko', '(2.5 s of speech, not translated into Korean (한국어): TRANSLATOR=fake)'],
    ]);
  });

  it('does not know which language was spoken, so every translation is posted', async () => {
    const translation = await new PlaceholderTranslator().translate(
      SpeechAudio.fromPcm(new Uint8Array(2)),
      TranslationLanguages.of(LanguageCode.of('ja'))
    );

    expect(translation.spokenLanguage).toBeNull();
  });
});
