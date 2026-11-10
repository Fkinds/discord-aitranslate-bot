import type { Client } from 'discord.js';
import type { GuildId, UserId } from '../../domain/discord-ids';
import {
  PublishFailed,
  type TranslationPost,
  type TranslationPublisher,
} from '../../usecases/ports/translation-publisher';

/** Posts translations to a Discord text channel as "**speaker**: translation". */
export class DiscordTranslationPublisher implements TranslationPublisher {
  constructor(private readonly client: Pick<Client, 'channels' | 'guilds'>) {}

  async publish(post: TranslationPost): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(post.textChannelId.value);
      if (!channel?.isSendable()) {
        throw new PublishFailed(`The bot cannot post to channel ${post.textChannelId.value}`);
      }
      const speaker = await this.speakerName(post.guildId, post.speakerId);
      await channel.send(`**${speaker}**: ${post.translation.translated}`);
    } catch (error) {
      if (error instanceof PublishFailed) throw error;
      throw new PublishFailed(`Failed to post to channel ${post.textChannelId.value}`, { cause: error });
    }
  }

  /** The speaker's name as the server shows it. */
  private async speakerName(guildId: GuildId, userId: UserId): Promise<string> {
    const guild = this.client.guilds.cache.get(guildId.value);
    if (!guild) throw new PublishFailed(`The bot is not in server ${guildId.value}`);
    const member = await guild.members.fetch(userId.value);
    return member.displayName || member.user.username;
  }
}
