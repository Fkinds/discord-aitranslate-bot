import { getVoiceConnections } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import sodium from 'libsodium-wrappers';
import { type Config, readConfig, type TranslatorConfig } from './infrastructure/config';
import { DiscordTranslationPublisher } from './infrastructure/discord/discord-translation-publisher';
import { DiscordVoice } from './infrastructure/discord/discord-voice';
import { ClaudeTextTranslator } from './infrastructure/claude/claude-text-translator';
import { GeminiTranslator, geminiModel } from './infrastructure/gemini/gemini-translator';
import { LocalTranslator } from './infrastructure/local/local-translator';
import { missingModelFiles } from './infrastructure/local/model-download';
import { LOCAL_MODEL_FILES, type ModelFile } from './infrastructure/local/model-files';
import { OneAtATime } from './infrastructure/local/one-at-a-time';
import { WhisperRecognizer } from './infrastructure/local/whisper-recognizer';
import { PlaceholderTranslator } from './infrastructure/placeholder-translator';
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

/**
 * The translator the settings ask for.
 *
 * With Claude, Whisper loads its models now, so that missing models stop the
 * bot at startup and the first utterance does not wait for them, and the
 * utterances are taken one at a time. Each Claude and Gemini request may take
 * 15 s. Claude's SDK tries a failure that may pass
 * again, up to 3 attempts in all. A transient Gemini failure is tried again up
 * to 3 attempts in all, 1 s and then 2 s apart, or after the wait Gemini asks
 * for when that is at most 5 s.
 *
 * @throws Error when the local models are missing or cannot be loaded.
 */
export async function translatorFor(config: TranslatorConfig, logger: Logger, clock: Clock = () => new Date()): Promise<Translator> {
  switch (config.kind) {
    case 'claude': {
      await requireModels(LOCAL_MODEL_FILES, config.modelsDir);
      logger.info('Loading the local models', { modelsDir: config.modelsDir });
      const recognizer = await WhisperRecognizer.load(config.modelsDir, { threads: LOCAL_THREADS });
      logger.info('Loaded the local models');
      const claude = new ClaudeTextTranslator(config.apiKey, { timeoutMs: 15_000, maxRetries: 2 }, logger);
      return new OneAtATime(new LocalTranslator(recognizer, claude), clock, logger);
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
