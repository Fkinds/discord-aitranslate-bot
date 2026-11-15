import { describe, it, expect } from '@jest/globals';
import { Client, Events, MessageFlags } from 'discord.js';
import { readConfig } from '../../src/infrastructure/config';
import { GeminiTranslator } from '../../src/infrastructure/gemini/gemini-translator';
import { PlaceholderTranslator } from '../../src/infrastructure/placeholder-translator';
import { compose, startNoticeFor, translatorFor } from '../../src/main';
import { FakeLogger } from '../support/fakes/fake-logger';

const config = readConfig({ DISCORD_BOT_TOKEN: 'token', DISCORD_CLIENT_ID: '123', TRANSLATOR: 'fake' }, '/srv/bot');

// With TRANSLATOR=claude, Whisper loads its models from files: tests/medium/main.test.ts.
describe('translatorFor', () => {
  it('translates with Gemini with TRANSLATOR=gemini', async () => {
    await expect(
      translatorFor({ kind: 'gemini', apiKey: 'key', model: 'gemini-3.8-flash' }, new FakeLogger())
    ).resolves.toBeInstanceOf(GeminiTranslator);
  });

  it('stands in a placeholder with TRANSLATOR=fake', async () => {
    await expect(translatorFor({ kind: 'fake' }, new FakeLogger())).resolves.toBeInstanceOf(PlaceholderTranslator);
  });
});

describe('startNoticeFor', () => {
  it('says that what is said is transcribed on the machine the bot runs on, and the text goes to Claude', () => {
    expect(startNoticeFor({ kind: 'claude', apiKey: 'key', modelsDir: '/srv/bot/models' })).toBe(
      "What is said there is transcribed on the bot's own machine, and the text is sent to Anthropic's Claude to be translated."
    );
  });

  it('says that what is said goes to Google Gemini', () => {
    expect(startNoticeFor({ kind: 'gemini', apiKey: 'key', model: 'gemini-3.8-flash' })).toContain('sent to Google Gemini');
  });

  it('says that nothing is sent anywhere with TRANSLATOR=fake', () => {
    expect(startNoticeFor({ kind: 'fake' })).toBe('What is said there is not sent anywhere (TRANSLATOR=fake).');
  });
});

describe('compose', () => {
  it('answers the slash commands Discord sends', async () => {
    const client = new Client({ intents: [] });
    compose(config, client, new PlaceholderTranslator(), new FakeLogger());
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
    compose(config, client, new PlaceholderTranslator(), new FakeLogger());

    expect(() => client.emit(Events.InteractionCreate, { isChatInputCommand: () => false } as never)).not.toThrow();
  });
});
