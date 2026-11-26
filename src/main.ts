import { getVoiceConnections } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import sodium from 'libsodium-wrappers';
import { type Config, readConfig, type TranslatorConfig } from './infrastructure/config';
import { DiscordTranslationPublisher } from './infrastructure/discord/discord-translation-publisher';
import { DiscordVoice } from './infrastructure/discord/discord-voice';
import { type ClaudeCredentials, ClaudeTextTranslator } from './infrastructure/claude/claude-text-translator';
import { GeminiTranslator, geminiModel } from './infrastructure/gemini/gemini-translator';
import { LocalTranslator } from './infrastructure/local/local-translator';
import { missingModelFiles } from './infrastructure/local/model-download';
import { LOCAL_MODEL_FILES, type ModelFile } from './infrastructure/local/model-files';
import { WhisperRecognizer } from './infrastructure/local/whisper-recognizer';
import { OllamaClient, OllamaRequestFailed } from './infrastructure/ollama/ollama-client';
import { isOnThisMachine } from './infrastructure/ollama/ollama-host';
import { PlaceholderTranslator } from './infrastructure/placeholder-translator';
import { TranslateGemmaTextTranslator } from './infrastructure/translategemma/translategemma-text-translator';
import { createLogger } from './infrastructure/winston-logger';
import { CommandHandler } from './interfaces/discord/command-handler';
import { VoiceEventHandler } from './interfaces/discord/voice-event-handler';
import { ChangeLanguages } from './usecases/change-languages';
import { EndDisconnectedSession } from './usecases/end-disconnected-session';
import { GetTranslationStatus } from './usecases/get-translation-status';
import type { Clock } from './usecases/ports/clock';
import type { Logger } from './usecases/ports/logger';
import type { Translator } from './usecases/ports/translator';
import { RecordSpeakingStarted, RecordSpeakingStopped } from './usecases/record-speaking';
import { SessionStore } from './usecases/session-store';
import { StartTranslation } from './usecases/start-translation';
import { StopTranslation } from './usecases/stop-translation';
import { TranslateUtterance } from './usecases/translate-utterance';

/** The CPU threads Whisper uses on this machine. */
const LOCAL_THREADS = 4;

/** Give up on an utterance that has waited this long since it ended: a later translation is no use to the conversation (#119). */
const LOCAL_OPTIONS = { maxWaitMs: 10_000 };

/** How long a request to Ollama may take, and how long to wait before trying one again (#86). */
const OLLAMA_OPTIONS = { timeoutMs: 15_000, retryDelayMs: 1_000 };

/** How long Ollama may take to load TranslateGemma at startup; the 12B model took 7 s in the trials. */
const TRANSLATEGEMMA_LOAD_TIMEOUT_MS = 120_000;

/** Fail, saying which files are missing and what to do, unless every one of them is in `modelsDir`. */
async function requireModels(files: readonly ModelFile[], modelsDir: string): Promise<void> {
  const missing = await missingModelFiles(files, modelsDir);
  if (missing.length > 0) {
    throw new Error(
      `The local models are missing from ${modelsDir}: ${missing.map((file) => file.path).join(', ')}. ` +
        'Run pnpm models:download, or set MODELS_DIR to where they are'
    );
  }
}

/** The credentials, for the log: what kind they are, and the IDs that say whose. */
function credentialsForLog(credentials: Exclude<ClaudeCredentials, { kind: 'none' }>): Record<string, unknown> {
  const { kind, ...ids } = credentials;
  return { credentials: kind, ...ids };
}

/**
 * Fail unless Claude can be called: when there are no credentials, or the API
 * refuses them, the model, or access to it, which trying again will not
 * change. When the API cannot be asked now, warn, and go on: it may pass.
 */
export async function requireClaude(claude: ClaudeTextTranslator, logger: Logger): Promise<void> {
  const credentials = await claude.credentials();
  if (credentials.kind === 'none') {
    throw new Error('There are no credentials for Claude. Sign in with ant auth login, or set ANTHROPIC_API_KEY');
  }
  logger.info('Calling Claude', credentialsForLog(credentials));

  const access = await claude.checkAccess();
  switch (access.kind) {
    case 'granted':
      logger.info('Claude can be called');
      return;
    case 'refused':
      throw new Error(`Claude cannot be called: ${access.reason}`);
    case 'unreachable':
      logger.warn('Could not check that Claude can be called; going on, and translations fail until it can be', {
        reason: access.reason,
      });
  }
}

/** Whether a failed request to Ollama may pass: Ollama could not be asked now, or failed. */
function mayPass(error: OllamaRequestFailed): boolean {
  return error.failure === 'unreachable' || error.failure === 'timeout' || (error.status ?? 0) >= 500;
}

/**
 * Fail unless Ollama has the TranslateGemma model, saying how to get it, then
 * load the model, so that the first translation does not wait for it. When
 * Ollama cannot be asked now, or cannot load the model, warn, and go on: it
 * may still be starting.
 */
export async function requireTranslateGemma(ollama: OllamaClient, model: string, logger: Logger): Promise<void> {
  logger.info('Checking that Ollama has TranslateGemma', { ollama: ollama.url, model });
  let has: boolean;
  try {
    has = await ollama.hasModel(model);
  } catch (error) {
    if (!(error instanceof OllamaRequestFailed)) throw error;
    if (!mayPass(error)) throw new Error(`Ollama cannot be asked for ${model}: ${error.message}`, { cause: error });
    logger.warn('Could not check that Ollama has TranslateGemma; going on, and translations fail until it can be', {
      reason: error.message,
    });
    return;
  }
  if (!has) throw new Error(`Ollama does not have ${model}. Run pnpm models:download, or ollama pull ${model}`);

  logger.info('Loading TranslateGemma', { model });
  try {
    await ollama.load(model, TRANSLATEGEMMA_LOAD_TIMEOUT_MS);
    logger.info('Loaded TranslateGemma');
  } catch (error) {
    if (!(error instanceof OllamaRequestFailed)) throw error;
    logger.warn('Could not load TranslateGemma; going on, and the first translation loads it', { reason: error.message });
  }
}

/** Whisper, from the models in `modelsDir`, which it loads now, so that the first utterance does not wait for them. */
async function loadWhisper(modelsDir: string, logger: Logger): Promise<WhisperRecognizer> {
  logger.info('Loading the local models', { modelsDir });
  const recognizer = await WhisperRecognizer.load(modelsDir, { threads: LOCAL_THREADS });
  logger.info('Loaded the local models');
  return recognizer;
}

/**
 * The translator the settings ask for.
 *
 * With Claude, the bot stops at startup when the models are missing or Claude
 * cannot be called, and Whisper loads its models now, so that the first
 * utterance does not wait for them. Whisper hears one utterance while the one
 * before it is translated, and one that has waited 10 s is given up on
 * (LocalTranslator). Each Claude and Gemini request may take 15 s. Claude's
 * SDK tries a failure that may pass again, up to 3 attempts in all. A
 * transient Gemini failure is tried again up to 3 attempts in all, 1 s and
 * then 2 s apart, or after the wait Gemini asks for when that is at most 5 s.
 *
 * With TranslateGemma, it is the same, but that the bot stops when Ollama does
 * not have the model, and loads it. Each request to Ollama may take 15 s; one
 * that could not be sent, or that Ollama failed, is tried again once, 1 s later.
 *
 * @throws Error when the local models are missing or cannot be loaded, Claude
 *   cannot be called, or Ollama does not have TranslateGemma.
 */
export async function translatorFor(config: TranslatorConfig, logger: Logger, clock: Clock = () => new Date()): Promise<Translator> {
  switch (config.kind) {
    case 'claude': {
      await requireModels(LOCAL_MODEL_FILES, config.modelsDir);
      const claude = new ClaudeTextTranslator(config.apiKey, { timeoutMs: 15_000, maxRetries: 2 }, logger);
      await requireClaude(claude, logger);
      const recognizer = await loadWhisper(config.modelsDir, logger);
      return new LocalTranslator(recognizer, claude, clock, logger, LOCAL_OPTIONS);
    }
    case 'translategemma': {
      await requireModels(LOCAL_MODEL_FILES, config.modelsDir);
      const ollama = new OllamaClient(new URL(config.ollamaUrl), OLLAMA_OPTIONS);
      await requireTranslateGemma(ollama, config.model, logger);
      const recognizer = await loadWhisper(config.modelsDir, logger);
      const translateGemma = new TranslateGemmaTextTranslator(ollama, config.model, logger);
      return new LocalTranslator(recognizer, translateGemma, clock, logger, LOCAL_OPTIONS);
    }
    case 'gemini':
      return new GeminiTranslator(
        geminiModel(config.apiKey, config.model, { timeoutMs: 15_000 }),
        { attempts: 3, initialDelayMs: 1000, maxAdvisedDelayMs: 5000 },
        logger
      );
    case 'fake':
      return new PlaceholderTranslator();
  }
}

/** What the notice that translation started says about where what is said goes. */
export function startNoticeFor(config: TranslatorConfig): string {
  switch (config.kind) {
    case 'claude':
      return "What is said there is transcribed on the bot's own machine, and the text is sent to Anthropic's Claude to be translated.";
    case 'gemini':
      return 'What is said there is sent to Google Gemini to be translated.';
    case 'translategemma':
      return isOnThisMachine(new URL(config.ollamaUrl))
        ? "What is said there is transcribed and translated on the bot's own machine, and sent nowhere."
        : "What is said there is transcribed on the bot's own machine, and the text is sent to a TranslateGemma server on Ollama to be translated.";
    case 'fake':
      return 'What is said there is not sent anywhere (TRANSLATOR=fake).';
  }
}

/** Build the bot's parts, and wire them to each other and to the Discord client. */
export function compose(
  config: Config,
  client: Client,
  translator: Translator,
  logger: Logger,
  clock: Clock = () => new Date()
): void {
  const sessions = new SessionStore();
  const voiceEvents = new VoiceEventHandler(
    {
      recordSpeakingStarted: new RecordSpeakingStarted(sessions),
      recordSpeakingStopped: new RecordSpeakingStopped(sessions),
      translateUtterance: new TranslateUtterance(sessions, translator, new DiscordTranslationPublisher(client)),
      endDisconnectedSession: new EndDisconnectedSession(sessions),
    },
    logger
  );
  const voice = new DiscordVoice(client, voiceEvents, logger);
  const commands = new CommandHandler(
    {
      startTranslation: new StartTranslation(sessions, voice, clock, config.defaultLanguages),
      stopTranslation: new StopTranslation(sessions, voice),
      changeLanguages: new ChangeLanguages(sessions),
      getTranslationStatus: new GetTranslationStatus(sessions, clock),
    },
    clock,
    logger,
    startNoticeFor(config.translator)
  );

  client.once(Events.ClientReady, (ready) => {
    logger.info(`Logged in as ${ready.user.tag}`);
    logger.info(`Ready in ${ready.guilds.cache.size} guilds`);
  });
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) void commands.handle(interaction);
  });
  client.on(Events.Error, (error) => logger.error('Discord client error', { error }));
}

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  await sodium.ready;
  const config = readConfig(process.env, process.cwd());
  const logger = createLogger(config.logLevel);
  logger.info('Starting Discord Realtime Translator Bot', { translator: config.translator.kind });
  const translator = await translatorFor(config.translator, logger);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages],
  });
  compose(config, client, translator, logger);

  const shutdown = async () => {
    logger.info('Shutting down...');
    for (const connection of getVoiceConnections().values()) connection.destroy();
    await client.destroy();
    logger.info('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  try {
    await client.login(config.discordToken);
  } catch (error) {
    logger.error('Failed to login to Discord', { error });
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
