import { describe, it, expect, beforeEach } from '@jest/globals';
import { GuildId, UserId } from '../../../src/domain/discord-ids';
import { LanguageCode } from '../../../src/domain/language-code';
import { SpeechAudio } from '../../../src/usecases/ports/speech-audio';
import { PublishFailed, type TranslationPost } from '../../../src/usecases/ports/translation-publisher';
import { TranslationFailed } from '../../../src/usecases/ports/translator';
import { SessionStore } from '../../../src/usecases/session-store';
import { TranslateUtterance } from '../../../src/usecases/translate-utterance';
import { aSession } from '../../support/builders';
import { deferred } from '../../support/deferred';
import { FakeTranslationPublisher } from '../../support/fakes/fake-translation-publisher';
import { FakeTranslator } from '../../support/fakes/fake-translator';

const GUILD = GuildId.of('1');
const SPEAKER = UserId.of('30');
const SPEECH = SpeechAudio.fromPcm(new Uint8Array(3200));
const SILENCE = SpeechAudio.fromPcm(new Uint8Array(0));
/** The translations of a post, as [tag, text]. */
const posted = (post: TranslationPost | undefined) => post?.translations.map(({ language, text }) => [language.tag, text]);

describe('TranslateUtterance', () => {
  let sessions: SessionStore;
  let translator: FakeTranslator;
  let publisher: FakeTranslationPublisher;
  let translateUtterance: TranslateUtterance;

  const utterance = (audio: Promise<SpeechAudio> = Promise.resolve(SPEECH)) => ({
    guildId: GUILD,
    speakerId: SPEAKER,
    audio,
  });

  beforeEach(() => {
    sessions = new SessionStore();
    translator = new FakeTranslator();
    publisher = new FakeTranslationPublisher();
    translateUtterance = new TranslateUtterance(sessions, translator, publisher);
  });

  it("translates the speech into the session's language and posts it to its text channel", async () => {
    sessions.save(aSession({ language: 'ko', text: '20' }));

    const result = await translateUtterance.execute(utterance());

    expect(translator.requests).toEqual([{ bytes: 3200, languages: 'ko' }]);
    expect(result).toMatchObject({ kind: 'posted', translation: { original: '3200 bytes of speech', spokenLanguage: null } });
    expect(publisher.posts).toHaveLength(1);
    const [post] = publisher.posts;
    expect(post?.guildId.value).toBe('1');
    expect(post?.textChannelId.value).toBe('20');
    expect(post?.speakerId.value).toBe('30');
    expect(post?.original).toBe('3200 bytes of speech');
    expect(posted(post)).toEqual([['ko', 'translated into ko']]);
  });

  it('translates into the language set when the speaker started, as the bot always has', async () => {
    const running = aSession({ language: 'ja' });
    sessions.save(running);
    const speech = deferred<SpeechAudio>();

    const pending = translateUtterance.execute(utterance(speech.promise));
    sessions.save(running.changeTargetLanguage(LanguageCode.of('en')));
    speech.resolve(SPEECH);
    await pending;

    expect(translator.requests[0]?.languages).toBe('ja');
  });

  it('still posts what was said before the translation stopped, as the bot always has', async () => {
    sessions.save(aSession({ text: '20' }));
    const speech = deferred<SpeechAudio>();

    const pending = translateUtterance.execute(utterance(speech.promise));
    sessions.remove(GUILD);
    speech.resolve(SPEECH);

    await expect(pending).resolves.toMatchObject({ kind: 'posted' });
    expect(publisher.posts[0]?.textChannelId.value).toBe('20');
  });

  it.each([
    ['one language of a pair', 'ja', [['ko', 'translated into ko']]],
    ['the other language of a pair', 'ko', [['ja', 'translated into ja']]],
    ['neither language of a pair', null, [['ja', 'translated into ja'], ['ko', 'translated into ko']]],
  ])('posts what was said with its translation into the right languages when %s is spoken', async (_, spoken, expected) => {
    sessions.save(aSession({ language: 'ja', second: 'ko' }));
    translator.hears(spoken ? LanguageCode.of(spoken) : null);

    await translateUtterance.execute(utterance());

    expect(translator.requests).toEqual([{ bytes: 3200, languages: 'ja,ko' }]);
    expect(publisher.posts[0]?.original).toBe('3200 bytes of speech');
    expect(posted(publisher.posts[0])).toEqual(expected);
  });

  it("posts only what was said when it was said in the session's one language", async () => {
    sessions.save(aSession({ language: 'ja' }));
    translator.hears(LanguageCode.of('ja'));

    await translateUtterance.execute(utterance());

    expect(publisher.posts[0]?.original).toBe('3200 bytes of speech');
    expect(posted(publisher.posts[0])).toEqual([]);
  });

  it('posts nothing when the speech had no words in it', async () => {
    sessions.save(aSession());
    translator.hearsNothing();

    const result = await translateUtterance.execute(utterance());

    expect(result).toEqual({ kind: 'nothingHeard' });
    expect(publisher.posts).toEqual([]);
  });

  it('posts nothing when nothing was heard', async () => {
    sessions.save(aSession());

    const result = await translateUtterance.execute(utterance(Promise.resolve(SILENCE)));

    expect(result).toEqual({ kind: 'nothingHeard' });
    expect(translator.requests).toEqual([]);
    expect(publisher.posts).toEqual([]);
  });

  it('does nothing when no session was running when the speaker started', async () => {
    const result = await translateUtterance.execute(utterance());

    expect(result).toEqual({ kind: 'notRunning' });
    expect(translator.requests).toEqual([]);
  });

  it("passes on the audio's failure, even with no session running", async () => {
    const failure = new Error('stream closed');

    await expect(translateUtterance.execute(utterance(Promise.reject(failure)))).rejects.toBe(failure);
  });

  it('posts nothing when the translation fails', async () => {
    sessions.save(aSession());
    translator.failNext(new TranslationFailed('quota exceeded'));

    await expect(translateUtterance.execute(utterance())).rejects.toThrow(TranslationFailed);
    expect(publisher.posts).toEqual([]);
  });

  it('passes on a failure to post', async () => {
    sessions.save(aSession());
    publisher.failNext(new PublishFailed('missing permission'));

    await expect(translateUtterance.execute(utterance())).rejects.toThrow(PublishFailed);
  });
});

describe('SpeechAudio', () => {
  it('takes whole 16-bit samples', () => {
    expect(SpeechAudio.fromPcm(new Uint8Array(4)).pcm.byteLength).toBe(4);
  });

  it('rejects a byte that is half a sample', () => {
    expect(() => SpeechAudio.fromPcm(new Uint8Array(3))).toThrow(RangeError);
  });

  it('is empty when nothing was heard', () => {
    expect(SILENCE.isEmpty).toBe(true);
    expect(SPEECH.isEmpty).toBe(false);
  });
});
