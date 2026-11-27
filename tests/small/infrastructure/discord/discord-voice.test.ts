import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { Client } from 'discord.js';
import { ChannelId, GuildId, type UserId } from '../../../../src/domain/discord-ids';
import { DiscordVoice, type VoiceListener } from '../../../../src/infrastructure/discord/discord-voice';
import type { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { VoiceConnectionFailed } from '../../../../src/usecases/ports/voice-connector';
import { FakeLogger } from '../../../support/fakes/fake-logger';

jest.mock('@discordjs/voice', () => ({
  ...jest.requireActual<typeof import('@discordjs/voice')>('@discordjs/voice'),
  joinVoiceChannel: jest.fn(),
  entersState: jest.fn(),
  getVoiceConnection: jest.fn(),
}));

/** A voice connection as @discordjs/voice makes one: it starts signalling, and tells of each change of state. */
class FakeConnection extends EventEmitter {
  state: { status: VoiceConnectionStatus } = { status: VoiceConnectionStatus.Signalling };
  readonly joinConfig: { channelId: string | null };
  readonly receiver = {
    speaking: new EventEmitter(),
    subscriptions: new Map<string, Readable>(),
    subscribe: jest.fn((userId: string, _options: unknown) => {
      const stream = Readable.from([]);
      this.receiver.subscriptions.set(userId, stream);
      return stream;
    }),
  };
  readonly destroy = jest.fn(() => this.becomes(VoiceConnectionStatus.Destroyed));

  constructor(channelId: string) {
    super();
    this.joinConfig = { channelId };
  }

  becomes(status: VoiceConnectionStatus): void {
    const from = this.state;
    this.state = { status };
    this.emit('stateChange', from, this.state);
    if (from.status !== status) this.emit(status, from, this.state);
  }
}

class RecordingListener implements VoiceListener {
  readonly events: string[] = [];
  readonly speeches: Array<Promise<SpeechAudio>> = [];
  speakingStarted = (guildId: GuildId, userId: UserId) => this.events.push(`started ${guildId.value} ${userId.value}`);
  speakingStopped = (guildId: GuildId, userId: UserId) => this.events.push(`stopped ${guildId.value} ${userId.value}`);
  utteranceStarted = (guildId: GuildId, userId: UserId, speech: Promise<SpeechAudio>) => {
    this.events.push(`utterance ${guildId.value} ${userId.value}`);
    this.speeches.push(speech);
  };
  disconnected = (guildId: GuildId) => this.events.push(`disconnected ${guildId.value}`);
}

const GUILD = GuildId.of('1');
const VOICE = ChannelId.of('10');
const adapterCreator = () => ({ sendPayload: () => true, destroy: () => {} });
/** entersState is overloaded; this is its mock typed for the VoiceConnection overload. */
const connectionEntersState = entersState as unknown as jest.MockedFunction<
  (target: VoiceConnection, status: VoiceConnectionStatus, timeoutMs: number) => Promise<VoiceConnection>
>;

describe('DiscordVoice', () => {
  let guilds: Map<string, { voiceAdapterCreator: typeof adapterCreator; channels: { cache: Map<string, object> } }>;
  let connections: FakeConnection[];
  let listener: RecordingListener;
  let logger: FakeLogger;
  let voice: DiscordVoice;
  /** The connection the bot joined on first. */
  const first = () => connections[0] as FakeConnection;
  /** The connection the bot joined on last. */
  const last = () => connections.at(-1) as FakeConnection;

  beforeEach(() => {
    // The connection is given up on after a while: no test waits for real time.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    guilds = new Map([['1', { voiceAdapterCreator: adapterCreator, channels: { cache: new Map([['10', {}], ['11', {}]]) } }]]);
    connections = [];
    listener = new RecordingListener();
    logger = new FakeLogger();
    const client = { guilds: { cache: guilds } } as unknown as Pick<Client, 'guilds'>;
    voice = new DiscordVoice(client, listener, logger);
    jest.mocked(joinVoiceChannel).mockImplementation(({ channelId }) => {
      const connection = new FakeConnection(channelId);
      connections.push(connection);
      return connection as unknown as VoiceConnection;
    });
    connectionEntersState.mockImplementation(async (connection) => connection);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('join', () => {
    it('joins self-deafened and unmuted, as the bot always has, and waits for the connection', async () => {
      await voice.join(GUILD, VOICE);

      expect(joinVoiceChannel).toHaveBeenCalledWith({
        guildId: '1',
        channelId: '10',
        adapterCreator,
        selfDeaf: true,
        selfMute: false,
      });
      expect(connectionEntersState).toHaveBeenCalledWith(first() as unknown as VoiceConnection, VoiceConnectionStatus.Ready, 10_000);
    });

    it('counts a connection still on its way after the wait as joined', async () => {
      connectionEntersState.mockImplementation(async (connection) => {
        (connection as unknown as FakeConnection).state = { status: VoiceConnectionStatus.Connecting };
        throw new Error('The operation was aborted');
      });

      await expect(voice.join(GUILD, VOICE)).resolves.toBeUndefined();
      expect(first().destroy).not.toHaveBeenCalled();
    });

    it('gives up and disconnects when the connection fails', async () => {
      const cause = new Error('The operation was aborted');
      connectionEntersState.mockImplementation(async (connection) => {
        (connection as unknown as FakeConnection).state = { status: VoiceConnectionStatus.Disconnected };
        throw cause;
      });

      const failure = await voice.join(GUILD, VOICE).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(VoiceConnectionFailed);
      expect((failure as VoiceConnectionFailed).cause).toBe(cause);
      expect(first().destroy).toHaveBeenCalled();
    });

    it('fails without joining in a server the bot is not in', async () => {
      await expect(voice.join(GuildId.of('2'), VOICE)).rejects.toThrow(VoiceConnectionFailed);
      expect(joinVoiceChannel).not.toHaveBeenCalled();
    });
  });

  describe('leave', () => {
    it("destroys the server's connection", async () => {
      await voice.join(GUILD, VOICE);
      jest.mocked(getVoiceConnection).mockReturnValue(first() as unknown as VoiceConnection);

      await voice.leave(GUILD);

      expect(getVoiceConnection).toHaveBeenCalledWith('1');
      expect(first().destroy).toHaveBeenCalled();
    });

    it('does nothing when not connected', async () => {
      jest.mocked(getVoiceConnection).mockReturnValue(undefined);

      await expect(voice.leave(GUILD)).resolves.toBeUndefined();
    });
  });

  describe('what it hears', () => {
    beforeEach(async () => {
      await voice.join(GUILD, VOICE);
    });

    it("records a member's utterance until they have been silent for 800 ms", async () => {
      first().receiver.speaking.emit('start', '30');

      expect(listener.events).toEqual(['started 1 30', 'utterance 1 30']);
      expect(first().receiver.subscribe).toHaveBeenCalledWith('30', {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
      });
      expect((await listener.speeches[0])?.isEmpty).toBe(true);
    });

    it('does not start another utterance when a member resumes before it has ended', () => {
      first().receiver.speaking.emit('start', '30');
      first().receiver.speaking.emit('end', '30');
      first().receiver.speaking.emit('start', '30');

      expect(listener.events).toEqual(['started 1 30', 'utterance 1 30', 'stopped 1 30', 'started 1 30']);
      expect(first().receiver.subscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('joining again', () => {
    beforeEach(async () => {
      await voice.join(GUILD, VOICE);
      first().becomes(VoiceConnectionStatus.Ready);
    });

    /** Drop the last connection, as when Discord closes it: away from ready, on its way back. */
    const drop = () => {
      last().becomes(VoiceConnectionStatus.Connecting);
      last().becomes(VoiceConnectionStatus.Signalling);
    };

    it('joins again on a new connection when a dropped one is not back in 15 s', () => {
      drop();

      jest.advanceTimersByTime(14_999);
      expect(connections).toHaveLength(1);

      jest.advanceTimersByTime(1);
      expect(first().destroy).toHaveBeenCalled();
      expect(connections).toHaveLength(2);
      expect(last().joinConfig.channelId).toBe('10');
      expect(logger.messages('warn')).toEqual(['Voice connection has not come back; joining again']);
      expect(listener.events).toEqual([]);
    });

    it('leaves alone a dropped connection that is back within 15 s', () => {
      drop();
      jest.advanceTimersByTime(10_000);
      first().becomes(VoiceConnectionStatus.Ready);

      jest.advanceTimersByTime(60_000);

      expect(connections).toHaveLength(1);
    });

    it('joins again when a moderator disconnected the bot', () => {
      first().becomes(VoiceConnectionStatus.Disconnected);

      jest.advanceTimersByTime(15_000);

      expect(connections).toHaveLength(2);
      expect(last().joinConfig.channelId).toBe('10');
    });

    it('joins again on a connection that never got ready after joining', async () => {
      connectionEntersState.mockImplementation(async (connection) => {
        (connection as unknown as FakeConnection).state = { status: VoiceConnectionStatus.Signalling };
        throw new Error('The operation was aborted');
      });
      await voice.join(GuildId.of('1'), ChannelId.of('11'));
      const joined = connections.length;

      jest.advanceTimersByTime(15_000);

      expect(connections).toHaveLength(joined + 1);
      expect(last().joinConfig.channelId).toBe('11');
    });

    it('gives each new connection twice as long to be ready as the one before it, up to 60 s', () => {
      drop();
      jest.advanceTimersByTime(15_000);

      for (const ms of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
        const joined = connections.length;
        jest.advanceTimersByTime(ms - 1);
        expect(connections).toHaveLength(joined);
        jest.advanceTimersByTime(1);
        expect(connections).toHaveLength(joined + 1);
      }
    });

    it('starts over once a new connection is ready', () => {
      drop();
      jest.advanceTimersByTime(15_000 + 5_000);
      last().becomes(VoiceConnectionStatus.Ready);
      expect(logger.messages('info')).toContain('Voice connection is back');

      drop();
      jest.advanceTimersByTime(15_000);
      const joined = connections.length;
      jest.advanceTimersByTime(5_000);

      expect(connections).toHaveLength(joined + 1);
    });

    it('joins again in the channel a member moved the bot to', () => {
      first().joinConfig.channelId = '11';
      drop();

      jest.advanceTimersByTime(15_000);

      expect(last().joinConfig.channelId).toBe('11');
    });

    it('hears what is said on the new connection', () => {
      drop();
      jest.advanceTimersByTime(15_000);

      last().receiver.speaking.emit('start', '30');

      expect(listener.events).toEqual(['started 1 30', 'utterance 1 30']);
    });

    it.each([
      ['the voice channel is gone', () => guilds.get('1')?.channels.cache.delete('10')],
      ['the bot is no longer in the server', () => guilds.delete('1')],
    ])('stops, and tells the listener, when %s', (_case, arrange) => {
      arrange();
      drop();

      jest.advanceTimersByTime(15_000);
      jest.advanceTimersByTime(60_000);

      expect(connections).toHaveLength(1);
      expect(first().destroy).toHaveBeenCalled();
      expect(listener.events).toEqual(['disconnected 1']);
    });

    it('stops joining again once the bot leaves', async () => {
      drop();
      jest.mocked(getVoiceConnection).mockReturnValue(undefined);

      await voice.leave(GUILD);
      jest.advanceTimersByTime(60_000);

      expect(connections).toHaveLength(1);
      expect(first().destroy).toHaveBeenCalled();
      expect(listener.events).toEqual([]);
    });

    it('stops keeping a connection destroyed elsewhere, as at shutdown', () => {
      first().destroy();

      jest.advanceTimersByTime(60_000);

      expect(connections).toHaveLength(1);
      expect(listener.events).toEqual([]);
    });
  });
});
