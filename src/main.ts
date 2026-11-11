import { getVoiceConnections } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import sodium from 'libsodium-wrappers';
import { type Config, readConfig, type TranslatorConfig } from './infrastructure/config';
import { DiscordTranslationPublisher } from './infrastructure/discord/discord-translation-publisher';
import { DiscordVoice } from './infrastructure/discord/discord-voice';
import { GeminiTranslator, geminiModel } from './infrastructure/gemini/gemini-translator';
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

/**
 * The translator the settings ask for. Each Gemini request may take 15 s; a
 * transient failure is tried again up to 3 attempts in all, 1 s and then 2 s
 * apart, or after the wait Gemini asks for when that is at most 5 s.
 */
export function translatorFor(config: TranslatorConfig, logger: Logger): Translator {
  switch (config.kind) {
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
    case 'gemini':
      return 'What is said there is sent to Google Gemini to be translated.';
    case 'fake':
      return 'What is said there is not sent anywhere (TRANSLATOR=fake).';
  }
}

/** Build the bot's parts, and wire them to each other and to the Discord client. */
export function compose(config: Config, client: Client, logger: Logger, clock: Clock = () => new Date()): void {
  const sessions = new SessionStore();
  const voiceEvents = new VoiceEventHandler(
    {
      recordSpeakingStarted: new RecordSpeakingStarted(sessions),
      recordSpeakingStopped: new RecordSpeakingStopped(sessions),
      translateUtterance: new TranslateUtterance(
        sessions,
        translatorFor(config.translator, logger),
        new DiscordTranslationPublisher(client)
      ),
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
  dotenv.config();
  await sodium.ready;
  const config = readConfig(process.env);
  const logger = createLogger(config.logLevel);
  logger.info('Starting Discord Realtime Translator Bot', { translator: config.translator.kind });

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages],
  });
  compose(config, client, logger);

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
