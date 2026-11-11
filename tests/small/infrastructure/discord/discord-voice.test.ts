import { describe, it, expect, beforeEach, jest } from '@jest/globals';
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

class FakeConnection extends EventEmitter {
  state: { status: VoiceConnectionStatus } = { status: VoiceConnectionStatus.Signalling };
  readonly receiver = {
    speaking: new EventEmitter(),
    subscriptions: new Map<string, Readable>(),
    subscribe: jest.fn((userId: string, _options: unknown) => {
      const stream = Readable.from([]);
      this.receiver.subscriptions.set(userId, stream);
      return stream;
    }),
  };
  readonly destroy = jest.fn(() => {
    this.state = { status: VoiceConnectionStatus.Destroyed };
  });
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
const client = { guilds: { cache: new Map([['1', { voiceAdapterCreator: adapterCreator }]]) } } as unknown as Pick<Client, 'guilds'>;
const flush = () => new Promise((resolve) => setImmediate(resolve));
/** entersState is overloaded; this is its mock typed for the VoiceConnection overload. */
const connectionEntersState = entersState as unknown as jest.MockedFunction<
  (target: VoiceConnection, status: VoiceConnectionStatus, timeoutMs: number) => Promise<VoiceConnection>
>;

describe('DiscordVoice', () => {
  let connection: FakeConnection;
  let listener: RecordingListener;
  let voice: DiscordVoice;

  beforeEach(() => {
    connection = new FakeConnection();
    listener = new RecordingListener();
    voice = new DiscordVoice(client, listener, new FakeLogger());
    jest.mocked(joinVoiceChannel).mockReturnValue(connection as unknown as VoiceConnection);
    connectionEntersState.mockResolvedValue(connection as unknown as VoiceConnection);
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
      expect(entersState).toHaveBeenCalledWith(connection, VoiceConnectionStatus.Ready, 10_000);
    });

    it('counts a connection still on its way after the wait as joined', async () => {
      connectionEntersState.mockRejectedValue(new Error('The operation was aborted'));
      connection.state = { status: VoiceConnectionStatus.Connecting };

      await expect(voice.join(GUILD, VOICE)).resolves.toBeUndefined();
      expect(connection.destroy).not.toHaveBeenCalled();
    });

    it('gives up and disconnects when the connection fails', async () => {
      const cause = new Error('The operation was aborted');
      connectionEntersState.mockRejectedValue(cause);
      connection.state = { status: VoiceConnectionStatus.Disconnected };

      const failure = await voice.join(GUILD, VOICE).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(VoiceConnectionFailed);
      expect((failure as VoiceConnectionFailed).cause).toBe(cause);
      expect(connection.destroy).toHaveBeenCalled();
    });

    it('fails without joining in a server the bot is not in', async () => {
      await expect(voice.join(GuildId.of('2'), VOICE)).rejects.toThrow(VoiceConnectionFailed);
      expect(joinVoiceChannel).not.toHaveBeenCalled();
    });
  });

  describe('leave', () => {
    it("destroys the server's connection", async () => {
      jest.mocked(getVoiceConnection).mockReturnValue(connection as unknown as VoiceConnection);

      await voice.leave(GUILD);

      expect(getVoiceConnection).toHaveBeenCalledWith('1');
      expect(connection.destroy).toHaveBeenCalled();
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

    it("records a member's utterance until they have been silent for 300 ms", async () => {
      connection.receiver.speaking.emit('start', '30');

      expect(listener.events).toEqual(['started 1 30', 'utterance 1 30']);
      expect(connection.receiver.subscribe).toHaveBeenCalledWith('30', {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 300 },
      });
      expect((await listener.speeches[0])?.isEmpty).toBe(true);
    });

    it('does not start another utterance when a member resumes before it has ended', () => {
      connection.receiver.speaking.emit('start', '30');
      connection.receiver.speaking.emit('end', '30');
      connection.receiver.speaking.emit('start', '30');

      expect(listener.events).toEqual(['started 1 30', 'utterance 1 30', 'stopped 1 30', 'started 1 30']);
      expect(connection.receiver.subscribe).toHaveBeenCalledTimes(1);
    });

    it('reports a connection lost for good, and disconnects it', async () => {
      connectionEntersState.mockRejectedValue(new Error('The operation was aborted'));

      connection.emit(VoiceConnectionStatus.Disconnected);
      await flush();

      expect(entersState).toHaveBeenCalledWith(connection, VoiceConnectionStatus.Signalling, 5_000);
      expect(connection.destroy).toHaveBeenCalled();
      expect(listener.events).toEqual(['disconnected 1']);
    });

    it('waits for a dropped connection that starts reconnecting', async () => {
      connection.emit(VoiceConnectionStatus.Disconnected);
      await flush();

      expect(connection.destroy).not.toHaveBeenCalled();
      expect(listener.events).toEqual([]);
    });

    it('reports nothing when the bot left while the connection was dropped', async () => {
      connectionEntersState.mockImplementation(async () => {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); // /translate-leave
        throw new Error('The operation was aborted');
      });

      connection.emit(VoiceConnectionStatus.Disconnected);
      await flush();

      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(listener.events).toEqual([]);
    });
  });
});
