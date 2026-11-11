import { describe, it, expect } from '@jest/globals';
import { Client, Events, MessageFlags } from 'discord.js';
import { readConfig } from '../../src/infrastructure/config';
import { GeminiTranslator } from '../../src/infrastructure/gemini/gemini-translator';
import { PlaceholderTranslator } from '../../src/infrastructure/placeholder-translator';
import { compose, translatorFor } from '../../src/main';
import { FakeLogger } from '../support/fakes/fake-logger';

const config = readConfig({ DISCORD_BOT_TOKEN: 'token', DISCORD_CLIENT_ID: '123', TRANSLATOR: 'fake' });

describe('translatorFor', () => {
  it('translates with Gemini by default', () => {
    expect(translatorFor({ kind: 'gemini', apiKey: 'key', model: 'gemini-2.0-flash-exp' }, new FakeLogger())).toBeInstanceOf(
      GeminiTranslator
    );
  });

  it('stands in a placeholder with TRANSLATOR=fake', () => {
    expect(translatorFor({ kind: 'fake' }, new FakeLogger())).toBeInstanceOf(PlaceholderTranslator);
  });
});

describe('compose', () => {
  it('answers the slash commands Discord sends', async () => {
    const client = new Client({ intents: [] });
    compose(config, client, new FakeLogger());
    const replies: unknown[] = [];
    let answered!: () => void;
    const done = new Promise<void>((resolve) => (answered = resolve));

    client.emit(Events.InteractionCreate, {
      isChatInputCommand: () => true,
      commandName: 'translate-status',
      guildId: '1',
      user: { id: '40' },
      replied: false,
      deferred: false,
      reply: async (options: unknown) => {
        replies.push(options);
        answered();
      },
    } as never);
    await done;

    expect(replies).toEqual([{ content: '❌ Not currently active in this server', flags: MessageFlags.Ephemeral }]);
    await client.destroy();
  });

  it('ignores interactions other than slash commands', () => {
    const client = new Client({ intents: [] });
    compose(config, client, new FakeLogger());

    expect(() => client.emit(Events.InteractionCreate, { isChatInputCommand: () => false } as never)).not.toThrow();
  });
});
