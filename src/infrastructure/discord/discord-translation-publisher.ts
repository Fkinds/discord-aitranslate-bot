import type { Client } from 'discord.js';
import type { ChannelId, GuildId, UserId } from '../../domain/discord-ids';
import {
  PublishFailed,
  type SessionNotice,
  type TranslationPost,
  type TranslationPublisher,
} from '../../usecases/ports/translation-publisher';

/**
 * Posts to a Discord text channel what was said, under the speaker's name,
 * and below it each translation as a quote:
 *
 *     **Alice**: 안녕하세요
 *     > こんにちは
 *
 * and posts what it tells the members about the session (noticeText).
 *
 * It notifies nobody of the mentions in the post.
 */
export class DiscordTranslationPublisher implements TranslationPublisher {
  constructor(private readonly client: Pick<Client, 'channels' | 'guilds'>) {}

  async publish(post: TranslationPost): Promise<void> {
    await this.post(post.textChannelId, async () => postText(await this.speakerName(post.guildId, post.speakerId), post));
  }

  async announce(notice: SessionNotice): Promise<void> {
    await this.post(notice.textChannelId, async () => noticeText(notice));
  }

  /** Post the text to the channel, notifying nobody. */
  private async post(textChannelId: ChannelId, text: () => Promise<string>): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(textChannelId.value);
      if (!channel?.isSendable()) {
        throw new PublishFailed(`The bot cannot post to channel ${textChannelId.value}`);
      }
      await channel.send({
        content: await text(),
        // What was said, and the speaker's name, may read "@everyone" or a
        // role or user mention; show it as text and notify nobody.
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      if (error instanceof PublishFailed) throw error;
      throw new PublishFailed(`Failed to post to channel ${textChannelId.value}`, { cause: error });
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

/** The post's text: "**speaker**: original", then each translation quoted, line by line. */
export function postText(speaker: string, post: Pick<TranslationPost, 'original' | 'translations'>): string {
  const quoted = post.translations.map(({ text }) =>
    text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
  );
  return [`**${speaker}**: ${post.original}`, ...quoted].join('\n');
}

/**
 * What the bot tells the members about the session. It names the voice
 * channel by a mention, which Discord shows as the channel's name; but not
 * once the channel is gone, when Discord would show it as a deleted channel.
 */
export function noticeText(notice: SessionNotice): string {
  const voice = `<#${notice.voiceChannelId.value}>`;
  switch (notice.kind) {
    case 'connectionLost':
      return `⚠️ Lost the connection to ${voice}. Joining again; translation resumes once it is back.`;
    case 'connectionBack':
      return `✅ Back in ${voice}; translating again.`;
    case 'channelGone':
      return '⏹️ Stopped translating: the voice channel is gone.';
  }
}
