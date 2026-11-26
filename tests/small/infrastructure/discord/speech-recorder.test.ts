import { describe, it, expect, beforeEach } from '@jest/globals';
import { GuildId, UserId } from '../../../../src/domain/discord-ids';
import { toWav } from '../../../../src/infrastructure/audio/wav';
import type { VoiceListener } from '../../../../src/infrastructure/discord/discord-voice';
import { RecordingVoiceListener, recordingNameFor } from '../../../../src/infrastructure/discord/speech-recorder';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { FakeLogger } from '../../../support/fakes/fake-logger';

const GUILD = GuildId.of('1');
const MEMBER = UserId.of('30');
const OTHER = UserId.of('31');
const SPEECH = SpeechAudio.fromPcm(new Uint8Array([1, 0, 2, 0]));
const SILENCE = SpeechAudio.fromPcm(new Uint8Array(0));

/** A listener that records what it was told. */
class EventLog implements VoiceListener {
  readonly events: string[] = [];
  speakingStarted = (guildId: GuildId, userId: UserId) => this.events.push(`started ${guildId.value} ${userId.value}`);
  speakingStopped = (guildId: GuildId, userId: UserId) => this.events.push(`stopped ${guildId.value} ${userId.value}`);
  utteranceStarted = (guildId: GuildId, userId: UserId) => this.events.push(`utterance ${guildId.value} ${userId.value}`);
  disconnected = (guildId: GuildId) => this.events.push(`disconnected ${guildId.value}`);
}

/** Let every promise that can settle, settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('recordingNameFor', () => {
  it('names the file by when the utterance started and ended, in the basic format of ISO 8601, in UTC', () => {
    expect(recordingNameFor(new Date('2026-11-26T23:25:00.123+09:00'), new Date('2026-11-26T14:25:02.456Z'))).toBe(
      '20261126T142500.123Z-20261126T142502.456Z.wav'
    );
  });
});

describe('RecordingVoiceListener', () => {
  let inner: EventLog;
  let now: Date;
  let written: Array<{ file: string; bytes: Buffer }>;
  let logger: FakeLogger;
  let listener: RecordingVoiceListener;

  beforeEach(() => {
    inner = new EventLog();
    now = new Date('2026-11-26T14:25:00.000Z');
    written = [];
    logger = new FakeLogger();
    listener = new RecordingVoiceListener(inner, MEMBER, '/srv/recordings', () => now, logger, async (file, bytes) => {
      written.push({ file, bytes });
    });
  });

  it('passes on everything it hears', () => {
    listener.speakingStarted(GUILD, MEMBER);
    listener.utteranceStarted(GUILD, OTHER, Promise.resolve(SPEECH));
    listener.speakingStopped(GUILD, MEMBER);
    listener.disconnected(GUILD);

    expect(inner.events).toEqual(['started 1 30', 'utterance 1 31', 'stopped 1 30', 'disconnected 1']);
  });

  it("records the member's utterance as a WAVE file named by when it started and ended", async () => {
    let finish!: (audio: SpeechAudio) => void;
    listener.utteranceStarted(GUILD, MEMBER, new Promise((resolve) => (finish = resolve)));
    now = new Date('2026-11-26T14:25:02.500Z');
    finish(SPEECH);
    await settle();

    expect(written).toEqual([
      { file: '/srv/recordings/20261126T142500.000Z-20261126T142502.500Z.wav', bytes: toWav(SPEECH) },
    ]);
    expect(inner.events).toEqual(['utterance 1 30']);
  });

  it("records no one else's utterances, and no utterance with no speech", async () => {
    listener.utteranceStarted(GUILD, OTHER, Promise.resolve(SPEECH));
    listener.utteranceStarted(GUILD, MEMBER, Promise.resolve(SILENCE));
    await settle();

    expect(written).toEqual([]);
  });

  it('logs a failure to record, and still passes the utterance on', async () => {
    listener = new RecordingVoiceListener(inner, MEMBER, '/srv/recordings', () => now, logger, async () => {
      throw new Error('disk full');
    });

    listener.utteranceStarted(GUILD, MEMBER, Promise.resolve(SPEECH));
    await settle();

    expect(logger.messages('error')).toEqual(['Failed to record an utterance']);
    expect(inner.events).toEqual(['utterance 1 30']);
  });

  it('records nothing when the speech fails, leaving the failure to the listener', async () => {
    const failing = Promise.reject(new Error('stream destroyed'));
    failing.catch(() => {});

    listener.utteranceStarted(GUILD, MEMBER, failing);
    await settle();

    expect(written).toEqual([]);
    expect(inner.events).toEqual(['utterance 1 30']);
  });
});
