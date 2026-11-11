import { OpusEncoder } from '@discordjs/opus';
import {
  type DiscordGatewayAdapterCreator,
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { Client } from 'discord.js';
import { type ChannelId, type GuildId, UserId } from '../../domain/discord-ids';
import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { VoiceConnectionFailed, type VoiceConnector } from '../../usecases/ports/voice-connector';
import { recordUtterance } from './record-utterance';
import { DISCORD_CHANNELS, DISCORD_SAMPLE_RATE_HZ } from './speech-conversion';

/** What the bot hears in the voice channels it is in. */
export interface VoiceListener {
  speakingStarted(guildId: GuildId, userId: UserId): void;
  speakingStopped(guildId: GuildId, userId: UserId): void;
  /** A member started an utterance; `speech` resolves once they have been silent for a while. */
  utteranceStarted(guildId: GuildId, userId: UserId, speech: Promise<SpeechAudio>): void;
  /** The bot lost its voice connection in the server for good. */
  disconnected(guildId: GuildId): void;
}

export interface DiscordVoiceOptions {
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  /** How long to wait for the connection to be ready. */
  readonly readyTimeoutMs: number;
  /** How long a dropped connection has to start reconnecting before it counts as lost. */
  readonly reconnectTimeoutMs: number;
  /** How long a member must be silent for their utterance to end. */
  readonly silenceMs: number;
}

/** The values the bot has always used. */
export const DEFAULT_VOICE_OPTIONS: DiscordVoiceOptions = {
  selfDeaf: true,
  selfMute: false,
  readyTimeoutMs: 10_000,
  reconnectTimeoutMs: 5_000,
  silenceMs: 300,
};

/** Joins and leaves Discord voice channels, and tells the listener what it hears there. */
export class DiscordVoice implements VoiceConnector {
  constructor(
    private readonly client: Pick<Client, 'guilds'>,
    private readonly listener: VoiceListener,
    private readonly logger: Logger,
    private readonly options: DiscordVoiceOptions = DEFAULT_VOICE_OPTIONS
  ) {}

  async join(guildId: GuildId, voiceChannelId: ChannelId): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId.value);
    if (!guild) throw new VoiceConnectionFailed(`The bot is not in server ${guildId.value}`);

    const connection = joinVoiceChannel({
      guildId: guildId.value,
      channelId: voiceChannelId.value,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: this.options.selfDeaf,
      selfMute: this.options.selfMute,
    });
    this.watch(connection, guildId);
    this.listen(connection, guildId);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, this.options.readyTimeoutMs);
    } catch (error) {
      const { status } = connection.state;
      if (status === VoiceConnectionStatus.Connecting || status === VoiceConnectionStatus.Signalling) {
        // As the bot always has, a connection still on its way counts as joined.
        this.logger.info('Connection still establishing, continuing anyway', { guildId: guildId.value, status });
        return;
      }
      if (status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      throw new VoiceConnectionFailed(`Failed to join voice channel ${voiceChannelId.value}`, { cause: error });
    }
  }

  async leave(guildId: GuildId): Promise<void> {
    getVoiceConnection(guildId.value)?.destroy();
  }

  private watch(connection: VoiceConnection, guildId: GuildId): void {
    connection.on('stateChange', (from, to) => {
      this.logger.debug('Connection state changed', { guildId: guildId.value, from: from.status, to: to.status });
    });
    connection.on('error', (error) => {
      this.logger.error('Connection error', { guildId: guildId.value, error });
    });
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Moved to another channel, or reconnecting; not lost.
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, this.options.reconnectTimeoutMs),
          entersState(connection, VoiceConnectionStatus.Connecting, this.options.reconnectTimeoutMs),
        ]);
      } catch {
        // Left on purpose in the meantime: the session has already ended.
        if (connection.state.status === VoiceConnectionStatus.Destroyed) return;
        connection.destroy();
        this.listener.disconnected(guildId);
      }
    });
  }

  private listen(connection: VoiceConnection, guildId: GuildId): void {
    const { receiver } = connection;
    receiver.speaking.on('start', (userId: string) => {
      const speaker = UserId.of(userId);
      this.listener.speakingStarted(guildId, speaker);
      // Still recording their utterance: a short pause does not start another.
      if (receiver.subscriptions.has(userId)) return;

      const packets = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: this.options.silenceMs },
      });
      const decoder = new OpusEncoder(DISCORD_SAMPLE_RATE_HZ, DISCORD_CHANNELS);
      this.listener.utteranceStarted(guildId, speaker, recordUtterance(packets, decoder, this.logger));
    });
    receiver.speaking.on('end', (userId: string) => {
      this.listener.speakingStopped(guildId, UserId.of(userId));
    });
  }
}
