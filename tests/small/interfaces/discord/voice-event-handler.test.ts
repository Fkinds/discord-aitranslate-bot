import { describe, it, expect, beforeEach } from '@jest/globals';
import { GuildId, UserId } from '../../../../src/domain/discord-ids';
import { VoiceEventHandler } from '../../../../src/interfaces/discord/voice-event-handler';
import { EndDisconnectedSession } from '../../../../src/usecases/end-disconnected-session';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { PublishFailed } from '../../../../src/usecases/ports/translation-publisher';
import { TranslationAbandoned, TranslationFailed } from '../../../../src/usecases/ports/translator';
import { RecordSpeakingStarted, RecordSpeakingStopped } from '../../../../src/usecases/record-speaking';
import { SessionStore } from '../../../../src/usecases/session-store';
import { TranslateUtterance } from '../../../../src/usecases/translate-utterance';
import { aSession } from '../../../support/builders';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { FakeTranslationPublisher } from '../../../support/fakes/fake-translation-publisher';
import { FakeTranslator } from '../../../support/fakes/fake-translator';

const GUILD = GuildId.of('1');
const ALICE = UserId.of('30');
const speech = (bytes = 3200) => Promise.resolve(SpeechAudio.fromPcm(new Uint8Array(bytes)));

describe('VoiceEventHandler', () => {
  let sessions: SessionStore;
  let translator: FakeTranslator;
  let publisher: FakeTranslationPublisher;
  let logger: FakeLogger;
  let handler: VoiceEventHandler;

  beforeEach(() => {
    sessions = new SessionStore();
    translator = new FakeTranslator();
    publisher = new FakeTranslationPublisher();
    logger = new FakeLogger();
    handler = new VoiceEventHandler(
      {
        recordSpeakingStarted: new RecordSpeakingStarted(sessions),
        recordSpeakingStopped: new RecordSpeakingStopped(sessions),
        translateUtterance: new TranslateUtterance(sessions, translator, publisher),
        endDisconnectedSession: new EndDisconnectedSession(sessions, publisher),
      },
      logger
    );
  });

  it('keeps track of who is speaking', () => {
    sessions.save(aSession());

    handler.speakingStarted(GUILD, ALICE);
    expect(sessions.find(GUILD)?.activeSpeakers.map((id) => id.value)).toEqual(['30']);

    handler.speakingStopped(GUILD, ALICE);
    expect(sessions.find(GUILD)?.activeSpeakers).toEqual([]);
  });

  it('ignores speaking in a server with no session', () => {
    expect(() => handler.speakingStarted(GUILD, ALICE)).not.toThrow();
    expect(logger.messages('error')).toEqual([]);
  });

  it('translates and posts an utterance, and logs it', async () => {
    sessions.save(aSession());

    await handler.utteranceStarted(GUILD, ALICE, speech());

    expect(publisher.posts).toHaveLength(1);
    expect(logger.messages('info')).toEqual(['Translation posted']);
  });

  it('logs an utterance in which nothing was heard', async () => {
    sessions.save(aSession());

    await handler.utteranceStarted(GUILD, ALICE, speech(0));

    expect(logger.messages('debug')).toEqual(['Nothing heard in the utterance']);
  });

  it('logs an utterance that was not translated, and posts nothing', async () => {
    sessions.save(aSession());
    translator.translatesNothing();

    await handler.utteranceStarted(GUILD, ALICE, speech());

    expect(publisher.posts).toEqual([]);
    expect(logger.messages('info')).toEqual(['Utterance not translated; nothing posted']);
  });

  it('warns of an utterance dropped for waiting too long, with how long it waited, and posts nothing', async () => {
    sessions.save(aSession());
    translator.failNext(new TranslationAbandoned(12_000));

    await handler.utteranceStarted(GUILD, ALICE, speech());

    expect(publisher.posts).toEqual([]);
    expect(logger.entries).toContainEqual({
      level: 'warn',
      message: 'Dropped an utterance that waited too long to be translated',
      meta: { guildId: '1', userId: '30', waitedMs: 12_000 },
    });
    expect(logger.messages('error')).toEqual([]);
  });

  it('logs an utterance in a server with no session', async () => {
    await handler.utteranceStarted(GUILD, ALICE, speech());

    expect(logger.messages('warn')).toEqual(['Received audio stream for non-existent session']);
  });

  it.each([
    ['translating', 'Failed to translate an utterance', () => translator.failNext(new TranslationFailed('quota'))],
    ['posting', 'Failed to post a translation', () => publisher.failNext(new PublishFailed('missing permission'))],
  ])('logs a failure in %s, and does not reject', async (_, message, arrange) => {
    sessions.save(aSession());
    arrange();

    await expect(handler.utteranceStarted(GUILD, ALICE, speech())).resolves.toBeUndefined();
    expect(logger.messages('error')).toEqual([message]);
  });

  it('logs a failure in receiving the audio, and does not reject', async () => {
    sessions.save(aSession());

    await expect(handler.utteranceStarted(GUILD, ALICE, Promise.reject(new Error('stream destroyed')))).resolves.toBeUndefined();
    expect(logger.messages('error')).toEqual(['Failed to process audio stream']);
  });

  it('ends the session when the connection is lost for good, says so, and logs it', async () => {
    sessions.save(aSession());

    await handler.disconnected(GUILD);

    expect(sessions.find(GUILD)).toBeUndefined();
    expect(publisher.notices.map((notice) => notice.kind)).toEqual(['channelGone']);
    expect(logger.messages('warn')).toEqual(['Voice connection lost; translation ended']);
  });

  it('logs a failure to say that translation ended, and does not reject', async () => {
    sessions.save(aSession());
    publisher.failNext(new PublishFailed('Missing Access'));

    await expect(handler.disconnected(GUILD)).resolves.toBeUndefined();
    expect(sessions.find(GUILD)).toBeUndefined();
    expect(logger.messages('error')).toEqual(['Failed to post that translation ended']);
  });

  it('logs nothing when a connection is lost with no session', async () => {
    await handler.disconnected(GUILD);

    expect(logger.entries).toEqual([]);
  });
});
