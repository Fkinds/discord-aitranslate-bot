import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { LocalTranslator } from '../../../../src/infrastructure/local/local-translator';
import { LOCAL_MODEL_TIMEOUT_MS, localModelsDir } from '../../../support/local-models';
import { recordedSpeech } from '../../../support/recording';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');

// Whisper and Hy-MT2 together, from the models pnpm models:download puts in models/.
describe('LocalTranslator, with the local models', () => {
  let translator: LocalTranslator;

  beforeAll(async () => {
    translator = await LocalTranslator.load(localModelsDir(), { threads: 4 });
  }, LOCAL_MODEL_TIMEOUT_MS);

  afterAll(async () => {
    await translator?.close();
  });

  it(
    'hears Japanese in a Japanese ⇄ Korean session, and translates it into Korean',
    async () => {
      const translation = await translator.translate(recordedSpeech(), TranslationLanguages.of(JA, KO));

      expect(translation.original).toMatch(/岩田さんの車/);
      expect(translation.spokenLanguage).toBe(JA);
      expect(translation.translations).toEqual([{ language: KO, text: expect.stringMatching(/차/) }]);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );
});
