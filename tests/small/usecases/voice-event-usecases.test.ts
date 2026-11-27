import { describe, it, expect, beforeEach } from '@jest/globals';
import { GuildId, UserId } from '../../../src/domain/discord-ids';
import { EndDisconnectedSession } from '../../../src/usecases/end-disconnected-session';
import { RecordSpeakingStarted, RecordSpeakingStopped } from '../../../src/usecases/record-speaking';
import { PublishFailed } from '../../../src/usecases/ports/translation-publisher';
import { SessionStore } from '../../../src/usecases/session-store';
import { aSession } from '../../support/builders';
import { FakeTranslationPublisher } from '../../support/fakes/fake-translation-publisher';

const GUILD = GuildId.of('1');
const ALICE = UserId.of('30');
const BOB = UserId.of('31');

const speakerIds = (sessions: SessionStore) => sessions.find(GUILD)?.activeSpeakers.map((id) => id.value);

describe('voice event use cases', () => {
  let sessions: SessionStore;

  beforeEach(() => {
    sessions = new SessionStore();
  });

  describe('RecordSpeakingStarted and RecordSpeakingStopped', () => {
    it('keeps track of who is speaking', () => {
      sessions.save(aSession());
      const started = new RecordSpeakingStarted(sessions);
      const stopped = new RecordSpeakingStopped(sessions);

      started.execute({ guildId: GUILD, speakerId: ALICE });
      const result = started.execute({ guildId: GUILD, speakerId: BOB });
      expect(result.kind).toBe('recorded');
      expect(speakerIds(sessions)).toEqual(['30', '31']);

      stopped.execute({ guildId: GUILD, speakerId: ALICE });
      expect(speakerIds(sessions)).toEqual(['31']);
    });

    it('keeps the language and channels of the session', () => {
      sessions.save(aSession({ language: 'ko', voice: '10', text: '20' }));

      new RecordSpeakingStarted(sessions).execute({ guildId: GUILD, speakerId: ALICE });

      const session = sessions.find(GUILD);
      expect(session?.languages.toString()).toBe('ko');
      expect(session?.voiceChannelId.value).toBe('10');
      expect(session?.textChannelId.value).toBe('20');
    });

    it('does nothing when no session is running', () => {
      const command = { guildId: GUILD, speakerId: ALICE };

      expect(new RecordSpeakingStarted(sessions).execute(command)).toEqual({ kind: 'notRunning' });
      expect(new RecordSpeakingStopped(sessions).execute(command)).toEqual({ kind: 'notRunning' });
      expect(sessions.find(GUILD)).toBeUndefined();
    });
  });

  describe('EndDisconnectedSession', () => {
    let publisher: FakeTranslationPublisher;

    beforeEach(() => {
      publisher = new FakeTranslationPublisher();
    });

    it('ends the session, and says so in its text channel', async () => {
      const running = aSession({ voice: '10', text: '20' });
      sessions.save(running);

      const result = await new EndDisconnectedSession(sessions, publisher).execute({ guildId: GUILD });

      expect(result).toEqual({ kind: 'ended', session: running });
      expect(sessions.find(GUILD)).toBeUndefined();
      expect(publisher.notices).toEqual([
        { kind: 'channelGone', guildId: GUILD, textChannelId: running.textChannelId, voiceChannelId: running.voiceChannelId },
      ]);
    });

    it('has ended the session when it cannot say so', async () => {
      sessions.save(aSession());
      publisher.failNext(new PublishFailed('Missing Access'));

      await expect(new EndDisconnectedSession(sessions, publisher).execute({ guildId: GUILD })).rejects.toThrow(PublishFailed);
      expect(sessions.find(GUILD)).toBeUndefined();
    });

    it('does nothing when no session is running', async () => {
      await expect(new EndDisconnectedSession(sessions, publisher).execute({ guildId: GUILD })).resolves.toEqual({
        kind: 'notRunning',
      });
      expect(publisher.notices).toEqual([]);
    });
  });
});
