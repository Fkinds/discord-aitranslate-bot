import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { readConfig } from './infrastructure/config';
import { createLogger } from './infrastructure/winston-logger';
import { COMMANDS } from './interfaces/discord/commands';

/** Register the slash commands with Discord, for every server the bot is in. */
async function deployCommands(): Promise<void> {
  dotenv.config();
  const config = readConfig(process.env);
  const logger = createLogger(config.logLevel);

  logger.info('Starting command deployment');
  const rest = new REST().setToken(config.discordToken);

  try {
    logger.info(`Deploying ${COMMANDS.length} commands...`);
    const deployed = (await rest.put(Routes.applicationCommands(config.discordClientId), {
      body: COMMANDS,
    })) as Array<{ name: string; description: string }>;

    logger.info(`Successfully deployed ${deployed.length} commands globally`);
    for (const command of deployed) logger.info(`  - /${command.name}: ${command.description}`);
    logger.info('Command deployment complete');
  } catch (error) {
    logger.error('Failed to deploy commands', { error });
    process.exit(1);
  }
}

deployCommands().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
