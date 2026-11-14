import { describe, it, expect, afterAll } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OneAtATime } from '../../src/infrastructure/local/one-at-a-time';
import { translatorFor } from '../../src/main';
import { FakeLogger } from '../support/fakes/fake-logger';
import { LOCAL_MODEL_TIMEOUT_MS, localModelsDir } from '../support/local-models';

// The local translator as main.ts builds it, from the models pnpm models:download puts in models/.
describe('translatorFor, with TRANSLATOR=local', () => {
  const empty = mkdtemp(path.join(tmpdir(), 'models-'));

  afterAll(async () => {
    await rm(await empty, { recursive: true, force: true });
  });

  it(
    'loads the models, and translates one utterance at a time',
    async () => {
      const logger = new FakeLogger();

      const translator = await translatorFor({ kind: 'local', modelsDir: localModelsDir() }, logger);

      expect(translator).toBeInstanceOf(OneAtATime);
      expect(logger.messages('info')).toEqual(['Loading the local models', 'Loaded the local models']);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it('stops the bot at startup when the models are missing, saying which and what to do', async () => {
    const modelsDir = await empty;

    await expect(translatorFor({ kind: 'local', modelsDir }, new FakeLogger())).rejects.toThrow(
      new RegExp(`^The local models are missing from ${modelsDir}: silero-vad/silero_vad\\.onnx, .*\\. Run pnpm models:download`)
    );
  });
});
