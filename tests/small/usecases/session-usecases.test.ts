import { describe, it, expect, beforeEach } from '@jest/globals';
import { GuildId } from '../../../src/domain/discord-ids';
import { LanguageCode } from '../../../src/domain/language-code';
import { ChangeTargetLanguage } from '../../../src/usecases/change-target-language';
import { GetTranslationStatus } from '../../../src/usecases/get-translation-status';
import { SessionStore } from '../../../src/usecases/session-store';
import { StopTranslation } from '../../../src/usecases/stop-translation';
import { aSession, fixedClock, STARTED_AT } from '../../support/builders';
import { FakeVoiceConnector } from '../../support/fakes/fake-voice-connector';

const GUILD = GuildId.of('1');

describe('session use cases', () => {
  let sessions: SessionStore;

  beforeEach(() => {
    sessions = new SessionStore();
  });

  describe('StopTranslation', () => {
    let voice: FakeVoiceConnector;
    let stopTranslation: StopTranslation;

    beforeEach(() => {
      voice = new FakeVoiceConnector();
      stopTranslation = new StopTranslation(sessions, voice);
    });

    it('leaves the voice channel and ends the session', async () => {
      const running = aSession();
      sessions.save(running);

      const result = await stopTranslation.execute({ guildId: GUILD });

      expect(result).toEqual({ kind: 'stopped', session: running });
      expect(voice.leaves).toEqual(['1']);
      expect(sessions.find(GUILD)).toBeUndefined();
    });

    it('does nothing when no session is running', async () => {
      const result = await stopTranslation.execute({ guildId: GUILD });

      expect(result).toEqual({ kind: 'notRunning' });
      expect(voice.leaves).toEqual([]);
    });

    it('keeps the session when leaving fails', async () => {
      sessions.save(aSession());
      voice.failNextLeave(new Error('gateway closed'));

      await expect(stopTranslation.execute({ guildId: GUILD })).rejects.toThrow('gateway closed');
      expect(sessions.find(GUILD)).toBeDefined();
    });
  });

  describe('ChangeTargetLanguage', () => {
    it("changes the running session's language", () => {
      sessions.save(aSession({ language: 'ja' }));

      const result = new ChangeTargetLanguage(sessions).execute({
        guildId: GUILD,
        language: LanguageCode.of('ko'),
      });

      expect(result.kind).toBe('changed');
      expect(sessions.find(GUILD)?.targetLanguage.tag).toBe('ko');
    });

    it('changes to a pair of languages', () => {
      sessions.save(aSession({ language: 'ja' }));

      const result = new ChangeTargetLanguage(sessions).execute({
        guildId: GUILD,
        language: LanguageCode.of('ja'),
        secondLanguage: LanguageCode.of('ko'),
      });

      expect(result.kind).toBe('changed');
      expect(sessions.find(GUILD)?.languages.toString()).toBe('ja,ko');
    });

    it('refuses one language twice, and keeps the languages as they were', () => {
      sessions.save(aSession({ language: 'en' }));

      const result = new ChangeTargetLanguage(sessions).execute({
        guildId: GUILD,
        language: LanguageCode.of('ko'),
        secondLanguage: LanguageCode.of('ko'),
      });

      expect(result).toEqual({ kind: 'sameLanguageTwice' });
      expect(sessions.find(GUILD)?.languages.toString()).toBe('en');
    });

    it('does nothing when no session is running', () => {
      const result = new ChangeTargetLanguage(sessions).execute({
        guildId: GUILD,
        language: LanguageCode.of('ko'),
      });

      expect(result).toEqual({ kind: 'notRunning' });
      expect(sessions.find(GUILD)).toBeUndefined();
    });
  });

  describe('GetTranslationStatus', () => {
    it('reports the running session and its uptime', () => {
      const running = aSession({ startedAt: STARTED_AT });
      sessions.save(running);
      const now = new Date(STARTED_AT.getTime() + 125_000);

      const result = new GetTranslationStatus(sessions, fixedClock(now)).execute({ guildId: GUILD });

      expect(result).toEqual({ kind: 'running', session: running, uptimeMs: 125_000 });
    });

    it('reports that no session is running', () => {
      const result = new GetTranslationStatus(sessions, fixedClock(STARTED_AT)).execute({ guildId: GUILD });

      expect(result).toEqual({ kind: 'notRunning' });
    });
  });

  describe('SessionStore', () => {
    it("replaces a server's session when saving another for the same server", () => {
      sessions.save(aSession({ language: 'ja' }));
      sessions.save(aSession({ language: 'en' }));

      expect(sessions.find(GUILD)?.targetLanguage.tag).toBe('en');
    });

    it('keeps the sessions of different servers apart', () => {
      sessions.save(aSession({ guild: '1' }));
      sessions.save(aSession({ guild: '2' }));
      sessions.remove(GuildId.of('1'));

      expect(sessions.find(GuildId.of('1'))).toBeUndefined();
      expect(sessions.find(GuildId.of('2'))).toBeDefined();
    });

    it('removes a missing session without complaint', () => {
      expect(() => sessions.remove(GUILD)).not.toThrow();
    });
  });
});
