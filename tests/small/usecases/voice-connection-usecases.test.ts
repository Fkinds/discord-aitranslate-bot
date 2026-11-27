import { describe, it, expect, beforeEach } from '@jest/globals';
import { ChannelId, GuildId, UserId } from '../../../src/domain/discord-ids';
import { RecordChannelMove } from '../../../src/usecases/record-channel-move';
import { PublishFailed } from '../../../src/usecases/ports/translation-publisher';
import { ReportConnectionBack, ReportConnectionLost } from '../../../src/usecases/report-connection';
import { SessionStore } from '../../../src/usecases/session-store';
import { aSession } from '../../support/builders';
import { FakeTranslationPublisher } from '../../support/fakes/fake-translation-publisher';

const GUILD = GuildId.of('1');

describe('voice connection use cases', () => {
  let sessions: SessionStore;
  let publisher: FakeTranslationPublisher;

  beforeEach(() => {
    sessions = new SessionStore();
    publisher = new FakeTranslationPublisher();
  });

  describe.each([
    ['ReportConnectionLost', 'connectionLost', () => new ReportConnectionLost(sessions, publisher)],
    ['ReportConnectionBack', 'connectionBack', () => new ReportConnectionBack(sessions, publisher)],
  ] as const)('%s', (_name, kind, reporter) => {
    it("says so in the session's text channel, naming its voice channel, and keeps the session", async () => {
      const running = aSession({ voice: '10', text: '20' });
      sessions.save(running);

      const result = await reporter().execute({ guildId: GUILD });

      expect(result).toEqual({ kind: 'reported', session: running });
      expect(publisher.notices).toEqual([
        { kind, guildId: GUILD, textChannelId: ChannelId.of('20'), voiceChannelId: ChannelId.of('10') },
      ]);
      expect(sessions.find(GUILD)).toBe(running);
    });

    it('fails when it cannot be said, and keeps the session', async () => {
      sessions.save(aSession());
      publisher.failNext(new PublishFailed('Missing Access'));

      await expect(reporter().execute({ guildId: GUILD })).rejects.toThrow(PublishFailed);
      expect(sessions.find(GUILD)).toBeDefined();
    });

    it('says nothing when no session is running', async () => {
      await expect(reporter().execute({ guildId: GUILD })).resolves.toEqual({ kind: 'notRunning' });
      expect(publisher.notices).toEqual([]);
    });
  });

  describe('RecordChannelMove', () => {
    it('moves the session to the voice channel the bot is in now', () => {
      sessions.save(aSession({ voice: '10', text: '20' }).speakerStarted(UserId.of('30')));

      const result = new RecordChannelMove(sessions).execute({ guildId: GUILD, voiceChannelId: ChannelId.of('11') });

      const session = sessions.find(GUILD);
      expect(result).toEqual({ kind: 'moved', session });
      expect(session?.voiceChannelId.value).toBe('11');
      expect(session?.textChannelId.value).toBe('20');
      expect(session?.activeSpeakers).toEqual([]);
    });

    it('does nothing when no session is running', () => {
      const command = { guildId: GUILD, voiceChannelId: ChannelId.of('11') };

      expect(new RecordChannelMove(sessions).execute(command)).toEqual({ kind: 'notRunning' });
      expect(sessions.find(GUILD)).toBeUndefined();
    });
  });
});
