import { type REST, type RESTPostAPIChatInputApplicationCommandsJSONBody, Routes } from 'discord.js';

/** A command as Discord reports it after registering. */
export interface RegisteredCommand {
  readonly name: string;
  readonly description: string;
}

/**
 * Register the slash commands with Discord for every server the bot is in,
 * replacing the ones registered before.
 *
 * @returns the commands as Discord now has them.
 * @throws whatever the REST client fails with, or an Error when Discord's
 *   answer is not a list of commands.
 */
export async function registerCommands(
  rest: REST,
  applicationId: string,
  commands: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[]
): Promise<RegisteredCommand[]> {
  const answer: unknown = await rest.put(Routes.applicationCommands(applicationId), { body: commands });
  if (!Array.isArray(answer) || !answer.every(isRegisteredCommand)) {
    throw new Error(`Discord answered the registration with something other than a list of commands: ${JSON.stringify(answer)}`);
  }
  return answer.map(({ name, description }) => ({ name, description }));
}

function isRegisteredCommand(value: unknown): value is RegisteredCommand {
  if (typeof value !== 'object' || value === null) return false;
  const { name, description } = value as Record<string, unknown>;
  return typeof name === 'string' && typeof description === 'string';
}
