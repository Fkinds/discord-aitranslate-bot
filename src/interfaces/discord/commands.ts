import { type RESTPostAPIChatInputApplicationCommandsJSONBody, SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { SUPPORTED_LANGUAGES } from '../../domain/language-code';

export const COMMAND = {
  join: 'translate-join',
  leave: 'translate-leave',
  language: 'translate-language',
  status: 'translate-status',
} as const;

export const LANGUAGE_OPTION = 'language';
export const SECOND_LANGUAGE_OPTION = 'second-language';

const SECOND_LANGUAGE_DESCRIPTION = 'Second language: what is said in either language is translated into the other';

/** A language option offering the supported languages, in their order. */
function languageOption(option: SlashCommandStringOption, name: string, description: string, required: boolean) {
  return option
    .setName(name)
    .setDescription(description)
    .setRequired(required)
    .addChoices(...SUPPORTED_LANGUAGES.map((language) => ({ name: language.displayName, value: language.tag })));
}

/** The bot's slash commands, as registered with Discord. */
export const COMMANDS: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName(COMMAND.join)
    .setDescription('Join voice channel and start real-time translation')
    .addStringOption((option) => languageOption(option, LANGUAGE_OPTION, 'Target language for translation', false))
    .addStringOption((option) => languageOption(option, SECOND_LANGUAGE_OPTION, SECOND_LANGUAGE_DESCRIPTION, false))
    .toJSON(),
  new SlashCommandBuilder().setName(COMMAND.leave).setDescription('Leave voice channel and stop translation').toJSON(),
  new SlashCommandBuilder()
    .setName(COMMAND.language)
    .setDescription('Change translation target language')
    .addStringOption((option) => languageOption(option, LANGUAGE_OPTION, 'New target language', true))
    .addStringOption((option) => languageOption(option, SECOND_LANGUAGE_OPTION, SECOND_LANGUAGE_DESCRIPTION, false))
    .toJSON(),
  new SlashCommandBuilder().setName(COMMAND.status).setDescription('Check translation status').toJSON(),
];
