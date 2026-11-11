import { describe, it, expect, beforeEach } from '@jest/globals';
import { type ChatInputCommandInteraction, type EmbedBuilder, MessageFlags } from 'discord.js';
import { GuildId } from '../../../../src/domain/discord-ids';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { CommandHandler } from '../../../../src/interfaces/discord/command-handler';
import { ChangeLanguages } from '../../../../src/usecases/change-languages';
import { GetTranslationStatus } from '../../../../src/usecases/get-translation-status';
import { VoiceConnectionFailed } from '../../../../src/usecases/ports/voice-connector';
import { SessionStore } from '../../../../src/usecases/session-store';
import { StartTranslation } from '../../../../src/usecases/start-translation';
import { StopTranslation } from '../../../../src/usecases/stop-translation';
import { aSession, fixedClock, STARTED_AT } from '../../../support/builders';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { FakeVoiceConnector } from '../../../support/fakes/fake-voice-connector';

interface Answer {
  via: 'reply' | 'editReply';
  content?: string;
  embeds?: EmbedBuilder[];
  flags?: unknown;
}

/** The parts of a ChatInputCommandInteraction the handler touches. */
class FakeInteraction {
  replied = false;
  readonly deferred = false;
  readonly answers: Answer[] = [];
  /** Messages posted for everyone in the channel. */
  readonly notices: unknown[] = [];
  noticeError: Error | undefined;
  readonly user = { id: '40' };
  readonly channelId = '20';
  readonly guildId: string | null;
  readonly member: { voice: { channel: { id: string; name: string } | null } };
  readonly options: { getString(name: string, required?: boolean): string | null };

  constructor(
    readonly commandName: string,
    {
      guildId = '1',
      voiceChannel = null,
      strings = {},
    }: { guildId?: string | null; voiceChannel?: { id: string; name: string } | null; strings?: Record<string, string> } = {}
  ) {
    this.guildId = guildId;
    this.member = { voice: { channel: voiceChannel } };
    this.options = {
      getString: (name, required) => {
        const value = strings[name];
        if (value === undefined && required) throw new Error(`Missing required option ${name}`);
        return value ?? null;
      },
    };
  }

  async reply(options: Omit<Answer, 'via'>): Promise<void> {
    this.replied = true;
    this.answers.push({ via: 'reply', ...options });
  }

  async editReply(options: Omit<Answer, 'via'>): Promise<void> {
    this.answers.push({ via: 'editReply', ...options });
  }

  async followUp(options: unknown): Promise<void> {
    if (this.noticeError) throw this.noticeError;
    this.notices.push(options);
  }
}

const GENERAL = { id: '10', name: 'General' };
const NOTICE = 'What is said there is sent to Google Gemini to be translated.';
const EPHEMERAL = MessageFlags.Ephemeral;

describe('CommandHandler', () => {
  let sessions: SessionStore;
  let voice: FakeVoiceConnector;
  let logger: FakeLogger;
  let handler: CommandHandler;

  const handle = async (interaction: FakeInteraction) => {
    await handler.handle(interaction as unknown as ChatInputCommandInteraction);
    return interaction.answers;
  };

  beforeEach(() => {
    sessions = new SessionStore();
    voice = new FakeVoiceConnector();
    logger = new FakeLogger();
    const clock = fixedClock(new Date(STARTED_AT.getTime() + 125_000));
    handler = new CommandHandler(
      {
        startTranslation: new StartTranslation(sessions, voice, clock, TranslationLanguages.of(LanguageCode.of('ja'))),
        stopTranslation: new StopTranslation(sessions, voice),
        changeLanguages: new ChangeLanguages(sessions),
        getTranslationStatus: new GetTranslationStatus(sessions, clock),
      },
      clock,
      logger,
      NOTICE
    );
  });

  describe('/translate-join', () => {
    it("says it is connecting, joins the member's voice channel, and says it has", async () => {
      const answers = await handle(new FakeInteraction('translate-join', { voiceChannel: GENERAL, strings: { language: 'en' } }));

      expect(answers).toEqual([
        { via: 'reply', content: '🔄 Connecting to **General**...', flags: EPHEMERAL },
        { via: 'editReply', content: '✅ Now translating in **General** to **English**' },
      ]);
      expect(voice.joins).toEqual([{ guildId: '1', voiceChannelId: '10' }]);
      expect(sessions.find(GuildId.of('1'))?.textChannelId.value).toBe('20');
    });

    it('tells everyone in the channel that it is translating, and where what is said goes', async () => {
      const interaction = new FakeInteraction('translate-join', { voiceChannel: GENERAL, strings: { language: 'en' } });

      await handle(interaction);

      expect(interaction.notices).toEqual([
        { content: `🎙️ Translating <#10> to **English**. ${NOTICE}`, allowedMentions: { parse: [] } },
      ]);
    });

    it('translates between a pair of languages', async () => {
      const interaction = new FakeInteraction('translate-join', {
        voiceChannel: GENERAL,
        strings: { language: 'ja', 'second-language': 'ko' },
      });

      const answers = await handle(interaction);

      expect(answers[1]?.content).toBe('✅ Now translating in **General** between **Japanese (日本語)** and **Korean (한국어)**');
      expect(sessions.find(GuildId.of('1'))?.languages.toString()).toBe('ja,ko');
    });

    it('refuses one language twice, and neither joins nor tells the channel', async () => {
      const interaction = new FakeInteraction('translate-join', {
        voiceChannel: GENERAL,
        strings: { language: 'ko', 'second-language': 'ko' },
      });

      const answers = await handle(interaction);

      expect(answers[1]).toEqual({ via: 'editReply', content: '❌ Choose two different languages' });
      expect(voice.joins).toEqual([]);
      expect(interaction.notices).toEqual([]);
    });

    it('keeps translating, and logs it, when the notice cannot be posted', async () => {
      const interaction = new FakeInteraction('translate-join', { voiceChannel: GENERAL });
      interaction.noticeError = new Error('Missing Permissions');

      const answers = await handle(interaction);

      expect(answers[1]?.content).toBe('✅ Now translating in **General** to **Japanese (日本語)**');
      expect(sessions.find(GuildId.of('1'))).toBeDefined();
      expect(logger.messages('error')).toEqual(['Failed to post the notice that translation started']);
    });

    it('translates into the default language when none is chosen', async () => {
      const answers = await handle(new FakeInteraction('translate-join', { voiceChannel: GENERAL }));

      expect(answers[1]?.content).toBe('✅ Now translating in **General** to **Japanese (日本語)**');
    });

    it('asks the member to join a voice channel first', async () => {
      const answers = await handle(new FakeInteraction('translate-join'));

      expect(answers).toEqual([{ via: 'reply', content: '❌ You need to be in a voice channel first!', flags: EPHEMERAL }]);
      expect(voice.joins).toEqual([]);
    });

    it('says where it is already translating', async () => {
      sessions.save(aSession({ voice: '99' }));

      const answers = await handle(new FakeInteraction('translate-join', { voiceChannel: GENERAL }));

      expect(answers[1]).toEqual({ via: 'editReply', content: '❌ Already translating in <#99>' });
    });

    it('says why joining failed, and logs it', async () => {
      voice.failNextJoin(new VoiceConnectionFailed('timed out'));

      const answers = await handle(new FakeInteraction('translate-join', { voiceChannel: GENERAL }));

      expect(answers[1]).toEqual({ via: 'editReply', content: '❌ Failed to join voice channel: timed out' });
      expect(logger.messages('error')).toEqual(['Failed to join voice channel']);
    });
  });

  describe('/translate-leave', () => {
    it('leaves and says so', async () => {
      sessions.save(aSession());

      const answers = await handle(new FakeInteraction('translate-leave'));

      expect(answers).toEqual([{ via: 'reply', content: '✅ Left the voice channel and stopped translation', flags: EPHEMERAL }]);
      expect(voice.leaves).toEqual(['1']);
    });

    it('says it is not in a voice channel', async () => {
      const answers = await handle(new FakeInteraction('translate-leave'));

      expect(answers[0]?.content).toBe('❌ Not currently in a voice channel');
    });

    it('says why leaving failed', async () => {
      sessions.save(aSession());
      voice.failNextLeave(new Error('gateway closed'));

      const answers = await handle(new FakeInteraction('translate-leave'));

      expect(answers[0]?.content).toBe('❌ Failed to leave: gateway closed');
    });
  });

  describe('/translate-language', () => {
    it('changes the language and says so', async () => {
      sessions.save(aSession({ language: 'ja' }));

      const answers = await handle(new FakeInteraction('translate-language', { strings: { language: 'ko' } }));

      expect(answers).toEqual([{ via: 'reply', content: '🔄 Target language changed to **Korean (한국어)**', flags: EPHEMERAL }]);
      expect(sessions.find(GuildId.of('1'))?.languages.toString()).toBe('ko');
    });

    it('changes to a pair of languages and says so', async () => {
      sessions.save(aSession({ language: 'en' }));

      const answers = await handle(
        new FakeInteraction('translate-language', { strings: { language: 'ja', 'second-language': 'ko' } })
      );

      expect(answers[0]?.content).toBe('🔄 Now translating between **Japanese (日本語)** and **Korean (한국어)**');
      expect(sessions.find(GuildId.of('1'))?.languages.toString()).toBe('ja,ko');
    });

    it('refuses one language twice', async () => {
      sessions.save(aSession({ language: 'en' }));

      const answers = await handle(
        new FakeInteraction('translate-language', { strings: { language: 'ko', 'second-language': 'ko' } })
      );

      expect(answers[0]?.content).toBe('❌ Choose two different languages');
    });

    it('says to join first', async () => {
      const answers = await handle(new FakeInteraction('translate-language', { strings: { language: 'ko' } }));

      expect(answers[0]?.content).toBe('❌ Not currently in a voice channel. Use `/translate-join` first');
    });
  });

  describe('/translate-status', () => {
    it('shows the status', async () => {
      sessions.save(aSession({ startedAt: STARTED_AT }));

      const answers = await handle(new FakeInteraction('translate-status'));

      expect(answers).toHaveLength(1);
      expect(answers[0]?.flags).toBe(EPHEMERAL);
      const embed = answers[0]?.embeds?.[0]?.toJSON();
      expect(embed?.fields?.find((field) => field.name === 'Uptime')?.value).toBe('2m 5s');
    });

    it('says it is not active', async () => {
      const answers = await handle(new FakeInteraction('translate-status'));

      expect(answers[0]?.content).toBe('❌ Not currently active in this server');
    });
  });

  it('answers only in a server', async () => {
    const answers = await handle(new FakeInteraction('translate-status', { guildId: null }));

    expect(answers).toEqual([{ via: 'reply', content: 'This command can only be used in a server', flags: EPHEMERAL }]);
  });

  it('answers an unknown command', async () => {
    const answers = await handle(new FakeInteraction('translate-dance', { guildId: null }));

    expect(answers[0]?.content).toBe('Unknown command');
  });

  it('logs an unexpected failure and tells the member, without throwing', async () => {
    voice.failNextJoin(new Error('boom'));

    const answers = await handle(new FakeInteraction('translate-join', { voiceChannel: GENERAL }));

    expect(answers[1]).toEqual({ via: 'editReply', content: '❌ An error occurred while processing your command' });
    expect(logger.messages('error')).toEqual(['Command handling failed']);
  });
});
