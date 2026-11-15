import { describe, it, expect, afterAll } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OneAtATime } from '../../src/infrastructure/local/one-at-a-time';
import { translatorFor } from '../../src/main';
import { FakeLogger } from '../support/fakes/fake-logger';
import { LOCAL_MODEL_TIMEOUT_MS, localModelsDir } from '../support/local-models';

// Whisper with Claude, as main.ts builds it: the models from models/, Claude not called.
describe('translatorFor, with TRANSLATOR=claude', () => {
  const empty = mkdtemp(path.join(tmpdir(), 'models-'));

  afterAll(async () => {
    await rm(await empty, { recursive: true, force: true });
  });

  it(
    'loads Whisper, and translates one utterance at a time',
    async () => {
      const logger = new FakeLogger();

      const translator = await translatorFor({ kind: 'claude', apiKey: 'key', modelsDir: localModelsDir() }, logger);

      expect(translator).toBeInstanceOf(OneAtATime);
      expect(logger.messages('info')).toEqual(['Loading the local models', 'Loaded the local models']);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it('stops the bot at startup when the speech models are missing, without asking for the translation model', async () => {
    const modelsDir = await empty;

    const loading = translatorFor({ kind: 'claude', apiKey: 'key', modelsDir }, new FakeLogger());

    await expect(loading).rejects.toThrow(
      `The local models are missing from ${modelsDir}: silero-vad/silero_vad.onnx, whisper-large-v3-turbo/turbo-encoder.int8.onnx, ` +
        'whisper-large-v3-turbo/turbo-decoder.int8.onnx, whisper-large-v3-turbo/turbo-tokens.txt. ' +
        'Run pnpm models:download, or set MODELS_DIR to where they are'
    );
  });
});
