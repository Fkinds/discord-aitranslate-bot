import dotenv from 'dotenv';
import { readModelsConfig, type ModelsConfig } from './infrastructure/config';
import { downloadModels } from './infrastructure/local/model-download';
import { CANDIDATE_MODEL_FILES, LOCAL_MODEL_FILES } from './infrastructure/local/model-files';
import { OllamaClient, OllamaRequestFailed, type PullProgress } from './infrastructure/ollama/ollama-client';
import { createLogger } from './infrastructure/winston-logger';
import type { Logger } from './usecases/ports/logger';

/**
 * Have Ollama pull the TranslateGemma model, or find it there already,
 * logging each step and every tenth of each layer.
 */
async function pullTranslateGemma(
  { ollamaUrl, model }: NonNullable<ModelsConfig['translateGemma']>,
  logger: Logger
): Promise<void> {
  const ollama = new OllamaClient(new URL(ollamaUrl), { timeoutMs: 15_000, retryDelayMs: 1_000 });
  logger.info(`Making sure Ollama at ${ollama.url} has ${model}`);
  let last = { status: '', tenths: -1 };
  const report = ({ status, total, completed }: PullProgress) => {
    const tenths = total && completed !== undefined ? Math.floor((completed / total) * 10) : -1;
    if (status === last.status && tenths === last.tenths) return;
    last = { status, tenths };
    logger.info(tenths < 0 ? status : `${status}: ${tenths * 10}% of ${(total! / 1_000_000_000).toFixed(1)} GB`);
  };
  try {
    await ollama.pull(model, report);
  } catch (error) {
    if (!(error instanceof OllamaRequestFailed && error.failure === 'unreachable')) throw error;
    throw new Error(`${error.message}. Start Ollama, or install it from https://ollama.com/download, and run this again`, {
      cause: error,
    });
  }
  logger.info(`Ollama has ${model}`);
}

/**
 * Download the models for hearing speech on this machine into MODELS_DIR,
 * keeping the files already there and intact, and with
 * TRANSLATOR=translategemma, have Ollama pull TranslateGemma. With
 * --candidates, also the models of the recognizers `pnpm eval:speech` compares
 * with Whisper, which the bot does not use.
 */
async function downloadLocalModels(): Promise<void> {
  dotenv.config({ quiet: true });
  const config = readModelsConfig(process.env, process.cwd());
  const logger = createLogger(config.logLevel);

  const files = process.argv.includes('--candidates') ? [...LOCAL_MODEL_FILES, ...CANDIDATE_MODEL_FILES] : LOCAL_MODEL_FILES;
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  logger.info(`Making sure the local models are in ${config.modelsDir} (${(total / 1_000_000_000).toFixed(1)} GB in all)`);
  await downloadModels(files, config.modelsDir, { logger });
  logger.info('The local models are ready');

  if (config.translateGemma) await pullTranslateGemma(config.translateGemma, logger);
}

downloadLocalModels().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
