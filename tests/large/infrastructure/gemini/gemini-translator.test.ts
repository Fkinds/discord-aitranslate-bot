import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { DEFAULT_GEMINI_MODEL } from '../../../../src/infrastructure/config';
import { translatorFor } from '../../../../src/main';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { recordedSpeech } from '../../../support/recording';

/** A translation may take 3 attempts of 15 s each, and 3 s of waits between them. */
const TRANSLATION_TIMEOUT_MS = 60_000;

const JA = LanguageCode.of('ja');
const EN = LanguageCode.of('en');

// The translator as main.ts builds it, against the real Gemini API.
describe('Gemini translation, against the Gemini API', () => {
  it('hears Japanese, and translates what was said into English', async () => {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Set GOOGLE_GEMINI_API_KEY to run the large tests');
    const translator = await translatorFor({ kind: 'gemini', apiKey, model: DEFAULT_GEMINI_MODEL }, new FakeLogger());
    const speech = recordedSpeech();

    const translation = await translator.translate(speech, TranslationLanguages.of(JA, EN));

    const textIn = (language: LanguageCode) => translation.translations.find((t) => t.language.equals(language))?.text;
    expect(translation.spokenLanguage?.tag).toBe('ja');
    expect(translation.original.trim()).not.toBe('');
    expect(textIn(JA)?.trim()).toBeTruthy();
    expect(textIn(EN)).toMatch(/\bcars?\b/i);
  }, TRANSLATION_TIMEOUT_MS);
});
