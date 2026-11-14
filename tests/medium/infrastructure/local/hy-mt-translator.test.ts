import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../../../../src/domain/language-code';
import { HyMtTranslator } from '../../../../src/infrastructure/local/hy-mt-translator';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';
import { LOCAL_MODEL_TIMEOUT_MS, localModelsDir } from '../../../support/local-models';

const JA = LanguageCode.of('ja');
const EN = LanguageCode.of('en');
const KO = LanguageCode.of('ko');

/** The script each language offered in the commands is written in, or the name its translation keeps, inflected or not. */
const WRITTEN_IN: Readonly<Record<string, RegExp>> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  en: /\bIwata/,
  ko: /\p{Script=Hangul}/u,
  zh: /\p{Script=Han}/u,
  es: /\bIwata/,
  fr: /\bIwata/,
  de: /\bIwata/,
  it: /\bIwata/,
  pt: /\bIwata/,
  ru: /\p{Script=Cyrillic}/u,
};

// Hy-MT2-1.8B from the model pnpm models:download puts in models/, run by node-llama-cpp in a worker thread.
describe('HyMtTranslator, with the local model', () => {
  let translator: HyMtTranslator;

  beforeAll(async () => {
    translator = await HyMtTranslator.load(localModelsDir());
  }, LOCAL_MODEL_TIMEOUT_MS);

  afterAll(async () => {
    await translator?.close();
  });

  it(
    'translates Japanese into Korean and English',
    async () => {
      expect(await translator.translate('私たちは岩田さんの車でいきました。', KO)).toMatch(/차/);
      expect(await translator.translate('私たちは岩田さんの車でいきました。', EN)).toMatch(/\bcar\b/i);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'translates casual Korean into Japanese',
    async () => {
      expect(await translator.translate('어제 친구랑 같이 영화 봤는데 진짜 재밌었어', JA)).toMatch(/映画/);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'translates the same text the same way every time',
    async () => {
      const text = 'Shall we meet at the station at seven?';

      expect(await translator.translate(text, JA)).toBe(await translator.translate(text, JA));
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'translates into every language offered in the commands',
    async () => {
      const translations: Record<string, string> = {};
      for (const language of SUPPORTED_LANGUAGES) {
        translations[language.tag] = await translator.translate("We went in Mr. Iwata's car.", language);
      }

      for (const [tag, translation] of Object.entries(translations)) {
        expect([tag, translation]).toEqual([tag, expect.stringMatching(WRITTEN_IN[tag]!)]);
      }
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'fails every translation asked after the model has stopped',
    async () => {
      const stopped = await HyMtTranslator.load(localModelsDir());
      await stopped.close();

      await expect(stopped.translate('こんにちは', KO)).rejects.toThrow(TranslationFailed);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'fails to load when the model is missing, rather than waiting for it',
    async () => {
      const empty = await mkdtemp(path.join(tmpdir(), 'models-'));
      try {
        await expect(HyMtTranslator.load(empty)).rejects.toThrow(/Hy-MT2-1\.8B-Q4_K_M\.gguf/);
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it(
    'keeps the process running while a translation is awaited, and only then',
    async () => {
      // A process in which the translator is the only thing running: it must
      // wait for the translation, then end by itself.
      const script = `
        const { HyMtTranslator } = require('./src/infrastructure/local/hy-mt-translator');
        const { LanguageCode } = require('./src/domain/language-code');
        HyMtTranslator.load(process.argv[1])
          .then((translator) => translator.translate('こんにちは', LanguageCode.of('ko')))
          .then((translation) => console.log('translated: ' + translation));
      `;
      const repository = path.resolve(__dirname, '../../../..');

      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--require', require.resolve('ts-node/register/transpile-only'), '--eval', script, localModelsDir()],
        { cwd: repository, timeout: LOCAL_MODEL_TIMEOUT_MS / 2 }
      );

      expect(stdout).toMatch(/^translated: \p{Script=Hangul}/u);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );
});
