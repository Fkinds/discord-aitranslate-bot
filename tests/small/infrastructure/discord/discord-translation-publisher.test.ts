import { describe, it, expect, beforeEach } from '@jest/globals';
import type { Client } from 'discord.js';
import { ChannelId, GuildId, UserId } from '../../../../src/domain/discord-ids';
import { DiscordTranslationPublisher } from '../../../../src/infrastructure/discord/discord-translation-publisher';
import { PublishFailed, type TranslationPost } from '../../../../src/usecases/ports/translation-publisher';

/** The parts of a discord.js Client the publisher touches. */
class FakeDiscord {
  readonly messages: Array<{ content: string; allowedMentions?: unknown }> = [];
  sendable = true;
  channelExists = true;
  sendError: Error | undefined;
  member = { displayName: 'Alice', user: { username: 'alice_01' } };

  readonly client = {
    channels: {
      fetch: async (id: string) =>
        this.channelExists
          ? {
              id,
              isSendable: () => this.sendable,
              send: async (message: { content: string; allowedMentions?: unknown }) => {
                if (this.sendError) throw this.sendError;
                this.messages.push(message);
              },
            }
          : null,
    },
    guilds: {
      cache: new Map([['1', { members: { fetch: async () => this.member } }]]),
    },
  } as unknown as Pick<Client, 'channels' | 'guilds'>;

  get sent(): string[] {
    return this.messages.map((message) => message.content);
  }
}

const post = (guild = '1', translated = 'こんにちは'): TranslationPost => ({
  guildId: GuildId.of(guild),
  textChannelId: ChannelId.of('20'),
  speakerId: UserId.of('30'),
  translation: { original: 'Hello', translated, detectedLanguage: 'en' },
});

describe('DiscordTranslationPublisher', () => {
  let discord: FakeDiscord;
  let publisher: DiscordTranslationPublisher;

  beforeEach(() => {
    discord = new FakeDiscord();
    publisher = new DiscordTranslationPublisher(discord.client);
  });

  it("posts the translation under the speaker's name in the server", async () => {
    await publisher.publish(post());

    expect(discord.sent).toEqual(['**Alice**: こんにちは']);
  });

  it('notifies nobody of the mentions in what was said or in the name', async () => {
    discord.member = { displayName: '@here', user: { username: 'alice_01' } };

    await publisher.publish(post('1', '@everyone <@&40> <@50> 集合'));

    expect(discord.messages).toEqual([
      { content: '**@here**: @everyone <@&40> <@50> 集合', allowedMentions: { parse: [] } },
    ]);
  });

  it('falls back to the user name when the server shows no other name', async () => {
    discord.member = { displayName: '', user: { username: 'alice_01' } };

    await publisher.publish(post());

    expect(discord.sent).toEqual(['**alice_01**: こんにちは']);
  });

  it.each([
    ['the channel is gone', (d: FakeDiscord) => (d.channelExists = false)],
    ['the bot cannot post to the channel', (d: FakeDiscord) => (d.sendable = false)],
  ])('fails when %s', async (_, arrange) => {
    arrange(discord);

    await expect(publisher.publish(post())).rejects.toThrow(PublishFailed);
    expect(discord.sent).toEqual([]);
  });

  it('fails when the bot is not in the server', async () => {
    await expect(publisher.publish(post('2'))).rejects.toThrow('The bot is not in server 2');
  });

  it('fails with what Discord said as the cause', async () => {
    const cause = new Error('Missing Permissions');
    discord.sendError = cause;

    const failure = await publisher.publish(post()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PublishFailed);
    expect((failure as PublishFailed).cause).toBe(cause);
  });
});
