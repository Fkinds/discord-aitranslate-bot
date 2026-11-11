import { type ChatInputCommandInteraction, type GuildMember, MessageFlags } from 'discord.js';
import { ChannelId, GuildId } from '../../domain/discord-ids';
import { LanguageCode } from '../../domain/language-code';
import type { ChangeTargetLanguage } from '../../usecases/change-target-language';
import type { GetTranslationStatus } from '../../usecases/get-translation-status';
import type { Clock } from '../../usecases/ports/clock';
import type { Logger } from '../../usecases/ports/logger';
import { VoiceConnectionFailed } from '../../usecases/ports/voice-connector';
import type { StartTranslation } from '../../usecases/start-translation';
import type { StopTranslation } from '../../usecases/stop-translation';
import { unreachable } from '../unreachable';
import { COMMAND, LANGUAGE_OPTION } from './commands';
import { statusEmbed } from './status-embed';

export interface CommandUseCases {
  readonly startTranslation: StartTranslation;
  readonly stopTranslation: StopTranslation;
  readonly changeTargetLanguage: ChangeTargetLanguage;
  readonly getTranslationStatus: GetTranslationStatus;
}

type Interaction = ChatInputCommandInteraction;

/**
 * Handles the slash commands: reads the interaction into a use case's
 * command, runs the use case, and answers the member who asked. Answers are
 * visible only to that member.
 */
export class CommandHandler {
  constructor(
    private readonly useCases: CommandUseCases,
    private readonly clock: Clock,
    private readonly logger: Logger
  ) {}

  /** Never throws: a failure is logged and the member is told. */
  async handle(interaction: Interaction): Promise<void> {
    const { commandName } = interaction;
    this.logger.info('Handling command', { commandName, userId: interaction.user.id, guildId: interaction.guildId });
    try {
      if (!isCommandName(commandName)) return await answer(interaction, 'Unknown command');
      if (!interaction.guildId) return await answer(interaction, 'This command can only be used in a server');
      const guildId = GuildId.of(interaction.guildId);
      switch (commandName) {
        case COMMAND.join:
          return await this.join(interaction, guildId);
        case COMMAND.leave:
          return await this.leave(interaction, guildId);
        case COMMAND.language:
          return await this.changeLanguage(interaction, guildId);
        case COMMAND.status:
          return await this.status(interaction, guildId);
        default:
          return unreachable(commandName);
      }
    } catch (error) {
      this.logger.error('Command handling failed', { commandName, error });
      await answer(interaction, '❌ An error occurred while processing your command').catch((answerError: unknown) =>
        this.logger.error('Failed to answer the command', { commandName, error: answerError })
      );
    }
  }

  private async join(interaction: Interaction, guildId: GuildId): Promise<void> {
    const voiceChannel = (interaction.member as GuildMember | null)?.voice?.channel ?? null;
    // Joining can take longer than Discord waits for an answer, so say so first.
    if (voiceChannel) await answer(interaction, `🔄 Connecting to **${voiceChannel.name}**...`);

    const language = interaction.options.getString(LANGUAGE_OPTION);
    let result;
    try {
      result = await this.useCases.startTranslation.execute({
        guildId,
        requesterVoiceChannelId: voiceChannel ? ChannelId.of(voiceChannel.id) : null,
        textChannelId: ChannelId.of(interaction.channelId),
        targetLanguage: language ? LanguageCode.of(language) : undefined,
      });
    } catch (error) {
      if (!(error instanceof VoiceConnectionFailed)) throw error;
      this.logger.error('Failed to join voice channel', { guildId: guildId.value, error });
      return answer(interaction, `❌ Failed to join voice channel: ${error.message}`);
    }

    switch (result.kind) {
      case 'started': {
        const { session } = result;
        this.logger.info('Successfully joined voice channel', {
          guildId: guildId.value,
          channelId: session.voiceChannelId.value,
          targetLanguage: session.targetLanguage.tag,
        });
        const channel = voiceChannel ? `**${voiceChannel.name}**` : `<#${session.voiceChannelId.value}>`;
        return answer(interaction, `✅ Now translating in ${channel} to **${session.targetLanguage.displayName}**`);
      }
      case 'requesterNotInVoiceChannel':
        return answer(interaction, '❌ You need to be in a voice channel first!');
      case 'alreadyRunning':
        return answer(interaction, `❌ Already translating in <#${result.session.voiceChannelId.value}>`);
      default:
        return unreachable(result);
    }
  }

  private async leave(interaction: Interaction, guildId: GuildId): Promise<void> {
    let result;
    try {
      result = await this.useCases.stopTranslation.execute({ guildId });
    } catch (error) {
      this.logger.error('Failed to leave voice channel', { guildId: guildId.value, error });
      return answer(interaction, `❌ Failed to leave: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    switch (result.kind) {
      case 'stopped':
        this.logger.info('Successfully left voice channel', { guildId: guildId.value });
        return answer(interaction, '✅ Left the voice channel and stopped translation');
      case 'notRunning':
        return answer(interaction, '❌ Not currently in a voice channel');
      default:
        return unreachable(result);
    }
  }

  private async changeLanguage(interaction: Interaction, guildId: GuildId): Promise<void> {
    const language = LanguageCode.of(interaction.options.getString(LANGUAGE_OPTION, true));
    const result = this.useCases.changeTargetLanguage.execute({ guildId, language });

    switch (result.kind) {
      case 'changed':
        this.logger.info('Changed target language', { guildId: guildId.value, newLanguage: language.tag });
        return answer(interaction, `🔄 Target language changed to **${result.session.targetLanguage.displayName}**`);
      case 'notRunning':
        return answer(interaction, '❌ Not currently in a voice channel. Use `/translate-join` first');
      default:
        return unreachable(result);
    }
  }

  private async status(interaction: Interaction, guildId: GuildId): Promise<void> {
    const result = this.useCases.getTranslationStatus.execute({ guildId });

    switch (result.kind) {
      case 'running':
        await interaction.reply({
          embeds: [statusEmbed(result.session, result.uptimeMs, this.clock())],
          flags: MessageFlags.Ephemeral,
        });
        return;
      case 'notRunning':
        return answer(interaction, '❌ Not currently active in this server');
      default:
        return unreachable(result);
    }
  }
}

/** Answer the member who asked: a first answer, or a change to it. */
async function answer(interaction: Interaction, content: string): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

function isCommandName(name: string): name is (typeof COMMAND)[keyof typeof COMMAND] {
  return (Object.values(COMMAND) as string[]).includes(name);
}
