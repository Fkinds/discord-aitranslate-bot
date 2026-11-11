import { describe, it, expect } from '@jest/globals';
import { ChannelId, GuildId, UserId } from '../../../src/domain/discord-ids';
import { LanguageCode } from '../../../src/domain/language-code';
import { TranslationLanguages } from '../../../src/domain/translation-languages';
import { TranslationSession } from '../../../src/domain/translation-session';

const STARTED_AT = new Date('2026-11-11T09:00:00Z');

function startSession(guild = '1'): TranslationSession {
  return TranslationSession.start({
    guildId: GuildId.of(guild),
    voiceChannelId: ChannelId.of('10'),
    textChannelId: ChannelId.of('20'),
    targetLanguage: LanguageCode.of('ja'),
    startedAt: STARTED_AT,
  });
}

describe('TranslationSession', () => {
  describe('start', () => {
    it('starts with the given server, channels and language, and nobody speaking', () => {
      const session = startSession();

      expect(session.guildId.equals(GuildId.of('1'))).toBe(true);
      expect(session.voiceChannelId.equals(ChannelId.of('10'))).toBe(true);
      expect(session.textChannelId.equals(ChannelId.of('20'))).toBe(true);
      expect(session.targetLanguage.equals(LanguageCode.of('ja'))).toBe(true);
      expect(session.startedAt).toEqual(STARTED_AT);
      expect(session.activeSpeakers).toEqual([]);
    });

    it('keeps its start time even if the given Date changes later', () => {
      const startedAt = new Date(STARTED_AT);
      const session = TranslationSession.start({
        guildId: GuildId.of('1'),
        voiceChannelId: ChannelId.of('10'),
        textChannelId: ChannelId.of('20'),
        targetLanguage: LanguageCode.of('ja'),
        startedAt,
      });

      startedAt.setFullYear(2000);
      session.startedAt.setFullYear(2000);

      expect(session.startedAt).toEqual(STARTED_AT);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(startSession())).toBe(true);
    });
  });

  describe('languages', () => {
    const JA_KO = TranslationLanguages.of(LanguageCode.of('ja'), LanguageCode.of('ko'));

    it('starts with the languages given', () => {
      const session = TranslationSession.start({
        guildId: GuildId.of('1'),
        voiceChannelId: ChannelId.of('10'),
        textChannelId: ChannelId.of('20'),
        languages: JA_KO,
        startedAt: STARTED_AT,
      });

      expect(session.languages.equals(JA_KO)).toBe(true);
    });

    it('takes a target language, until its callers have moved, as that one language', () => {
      expect(startSession().languages.equals(TranslationLanguages.of(LanguageCode.of('ja')))).toBe(true);
    });

    it('returns a session with other languages, keeping who is speaking, and leaves this one as it was', () => {
      const session = startSession().speakerStarted(UserId.of('100'));

      const changed = session.changeLanguages(JA_KO);

      expect(changed.languages.equals(JA_KO)).toBe(true);
      expect(changed.activeSpeakers.map((id) => id.value)).toEqual(['100']);
      expect(session.languages.isPair).toBe(false);
      expect(changed.equals(session)).toBe(true);
    });

    it('gives the first of a pair as the target language, until its callers have moved', () => {
      expect(startSession().changeLanguages(JA_KO).targetLanguage.tag).toBe('ja');
    });
  });

  describe('changeTargetLanguage', () => {
    it('returns a session with the new language and leaves this one as it was', () => {
      const session = startSession();

      const changed = session.changeTargetLanguage(LanguageCode.of('en'));

      expect(changed.targetLanguage.tag).toBe('en');
      expect(session.targetLanguage.tag).toBe('ja');
      expect(changed.equals(session)).toBe(true);
    });
  });

  describe('speakers', () => {
    it('adds a speaker once, however often they start speaking', () => {
      const session = startSession()
        .speakerStarted(UserId.of('100'))
        .speakerStarted(UserId.of('100'))
        .speakerStarted(UserId.of('200'));

      expect(session.activeSpeakers.map((id) => id.value)).toEqual(['100', '200']);
    });

    it('removes a speaker who stopped, and ignores one who was silent', () => {
      const speaking = startSession().speakerStarted(UserId.of('100'));

      const session = speaking.speakerStopped(UserId.of('100')).speakerStopped(UserId.of('300'));

      expect(session.activeSpeakers).toEqual([]);
      expect(speaking.activeSpeakers.map((id) => id.value)).toEqual(['100']);
    });
  });

  describe('uptimeMs', () => {
    it.each([
      ['at the start', 0, 0],
      ['after 90 seconds', 90_000, 90_000],
      ['before the start, as with a clock set back', -1_000, 0],
    ])('is %s', (_case, offsetMs, expected) => {
      const now = new Date(STARTED_AT.getTime() + offsetMs);
      expect(startSession().uptimeMs(now)).toBe(expected);
    });
  });

  it('is the same session as another for the same server', () => {
    expect(startSession('1').equals(startSession('1').speakerStarted(UserId.of('5')))).toBe(true);
    expect(startSession('1').equals(startSession('2'))).toBe(false);
  });
});
