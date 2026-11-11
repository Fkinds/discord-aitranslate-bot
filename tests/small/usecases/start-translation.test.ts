import { describe, it, expect, beforeEach } from '@jest/globals';
import { ChannelId, GuildId } from '../../../src/domain/discord-ids';
import { LanguageCode } from '../../../src/domain/language-code';
import { TranslationLanguages } from '../../../src/domain/translation-languages';
import { VoiceConnectionFailed } from '../../../src/usecases/ports/voice-connector';
import { SessionStore } from '../../../src/usecases/session-store';
import { StartTranslation } from '../../../src/usecases/start-translation';
import { aSession, fixedClock, STARTED_AT } from '../../support/builders';
import { FakeVoiceConnector } from '../../support/fakes/fake-voice-connector';

describe('StartTranslation', () => {
  let sessions: SessionStore;
  let voice: FakeVoiceConnector;
  let startTranslation: StartTranslation;

  const command = (overrides: { voice?: string | null; language?: string; second?: string } = {}) => ({
    guildId: GuildId.of('1'),
    requesterVoiceChannelId: overrides.voice === null ? null : ChannelId.of(overrides.voice ?? '10'),
    textChannelId: ChannelId.of('20'),
    language: overrides.language ? LanguageCode.of(overrides.language) : undefined,
    secondLanguage: overrides.second ? LanguageCode.of(overrides.second) : undefined,
  });

  beforeEach(() => {
    sessions = new SessionStore();
    voice = new FakeVoiceConnector();
    startTranslation = new StartTranslation(sessions, voice, fixedClock(STARTED_AT), TranslationLanguages.of(LanguageCode.of('ja')));
  });

  it("joins the requester's voice channel and starts a session", async () => {
    const result = await startTranslation.execute(command({ language: 'en' }));

    expect(result.kind).toBe('started');
    expect(voice.joins).toEqual([{ guildId: '1', voiceChannelId: '10' }]);
    const session = sessions.find(GuildId.of('1'));
    expect(session?.voiceChannelId.value).toBe('10');
    expect(session?.textChannelId.value).toBe('20');
    expect(session?.targetLanguage.tag).toBe('en');
    expect(session?.startedAt).toEqual(STARTED_AT);
  });

  it('translates into the default language when none is given', async () => {
    await startTranslation.execute(command());

    expect(sessions.find(GuildId.of('1'))?.targetLanguage.tag).toBe('ja');
  });

  it.each([
    ['both languages of a pair', { language: 'en', second: 'ko' }, 'en,ko'],
    ['the second language only, with the default first', { second: 'ko' }, 'ja,ko'],
  ])('translates between %s', async (_, languages, expected) => {
    await startTranslation.execute(command(languages));

    expect(sessions.find(GuildId.of('1'))?.languages.toString()).toBe(expected);
  });

  it('translates between the default pair when none is given', async () => {
    const defaultPair = TranslationLanguages.of(LanguageCode.of('ja'), LanguageCode.of('ko'));
    const withPair = new StartTranslation(sessions, voice, fixedClock(STARTED_AT), defaultPair);

    await withPair.execute(command());

    expect(sessions.find(GuildId.of('1'))?.languages.toString()).toBe('ja,ko');
  });

  it.each([
    ['given twice', { language: 'ko', second: 'ko' }],
    ['given as the second that is the default first', { second: 'ja' }],
  ])('refuses one language %s, and does not join', async (_, languages) => {
    const result = await startTranslation.execute(command(languages));

    expect(result).toEqual({ kind: 'sameLanguageTwice' });
    expect(voice.joins).toEqual([]);
  });

  it('does nothing when the requester is not in a voice channel', async () => {
    const result = await startTranslation.execute(command({ voice: null }));

    expect(result).toEqual({ kind: 'requesterNotInVoiceChannel' });
    expect(voice.joins).toEqual([]);
    expect(sessions.find(GuildId.of('1'))).toBeUndefined();
  });

  it("reports the server's running session instead of joining again", async () => {
    const running = aSession({ voice: '99' });
    sessions.save(running);

    const result = await startTranslation.execute(command());

    expect(result).toEqual({ kind: 'alreadyRunning', session: running });
    expect(voice.joins).toEqual([]);
  });

  it('checks the voice channel before the running session, as the bot always has', async () => {
    sessions.save(aSession());

    const result = await startTranslation.execute(command({ voice: null }));

    expect(result.kind).toBe('requesterNotInVoiceChannel');
  });

  it('joins once when a second request arrives while the first is still connecting', async () => {
    const release = voice.holdJoins();

    const first = startTranslation.execute(command());
    const second = await startTranslation.execute(command());
    release();

    expect(second.kind).toBe('alreadyRunning');
    expect((await first).kind).toBe('started');
    expect(voice.joins).toHaveLength(1);
  });

  it('leaves no session behind when joining fails, so that it can be tried again', async () => {
    voice.failNextJoin(new VoiceConnectionFailed('timed out'));

    await expect(startTranslation.execute(command())).rejects.toThrow(VoiceConnectionFailed);
    expect(sessions.find(GuildId.of('1'))).toBeUndefined();

    await expect(startTranslation.execute(command())).resolves.toMatchObject({ kind: 'started' });
  });
});
