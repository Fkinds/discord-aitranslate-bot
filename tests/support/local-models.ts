import { existsSync } from 'node:fs';
import path from 'node:path';
import { CANDIDATE_MODEL_FILES, LOCAL_MODEL_FILES, type ModelFile } from '../../src/infrastructure/local/model-files';

/**
 * Where the medium tests find the local models: MODELS_DIR, or models/ in the
 * repository, as `pnpm models:download` puts them. Fails, rather than skipping
 * the tests, when a model file is missing.
 */
export function localModelsDir(): string {
  return modelsDirWith(LOCAL_MODEL_FILES, 'pnpm models:download');
}

/** Where the medium tests find the local models and the candidates compared with them, as `pnpm models:download --candidates` puts them. */
export function candidateModelsDir(): string {
  return modelsDirWith([...LOCAL_MODEL_FILES, ...CANDIDATE_MODEL_FILES], 'pnpm models:download --candidates');
}

function modelsDirWith(files: readonly ModelFile[], download: string): string {
  const dir = path.resolve(__dirname, '../..', process.env.MODELS_DIR || 'models');
  const missing = files.filter((file) => !existsSync(path.join(dir, ...file.path.split('/'))));
  if (missing.length > 0) {
    throw new Error(`The local models are missing from ${dir}: ${missing.map((file) => file.path).join(', ')}. Run ${download}`);
  }
  return dir;
}

/** Medium tests that run a local model may take this long: loading it, then running it on a CPU in CI. */
export const LOCAL_MODEL_TIMEOUT_MS = 60_000;
