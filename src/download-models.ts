import dotenv from 'dotenv';
import { readModelsConfig } from './infrastructure/config';
import { downloadModels } from './infrastructure/local/model-download';
import { LOCAL_MODEL_FILES } from './infrastructure/local/model-files';
import { createLogger } from './infrastructure/winston-logger';

/** Download the models the local translator needs into MODELS_DIR, keeping the files already there and intact. */
async function downloadLocalModels(): Promise<void> {
  dotenv.config();
  const config = readModelsConfig(process.env, process.cwd());
  const logger = createLogger(config.logLevel);

  const total = LOCAL_MODEL_FILES.reduce((sum, file) => sum + file.bytes, 0);
  logger.info(`Making sure the local models are in ${config.modelsDir} (${(total / 1_000_000_000).toFixed(1)} GB in all)`);
  await downloadModels(LOCAL_MODEL_FILES, config.modelsDir, { logger });
  logger.info('The local models are ready');
}

downloadLocalModels().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
