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
  /** How long to wait for the connection to be ready when joining. */
  readonly readyTimeoutMs: number;
  /**
   * How long a connection may be away from ready before it is given up on,
   * and the bot joins again on a new one. @discordjs/voice joins again by
   * itself after most drops, but then waits for Discord's answer without end.
   */
  readonly stuckAfterMs: number;
  /**
   * How long the first new connection has to be ready before it is given up
   * on in turn. Each one after it has twice as long, up to `maxRetryDelayMs`.
   */
  readonly retryDelayMs: number;
  readonly maxRetryDelayMs: number;
  /**
   * How long a member must be silent for their utterance to end. The pauses
   * people take within a sentence are longer than 300 ms, which cut sentences
   * into pieces Whisper misheard, and too many for the bot to keep up with
   * (#119).
   */
  readonly silenceMs: number;
}

/** The values the bot uses. */
export const DEFAULT_VOICE_OPTIONS: DiscordVoiceOptions = {
  selfDeaf: true,
  selfMute: false,
  readyTimeoutMs: 10_000,
  stuckAfterMs: 15_000,
  retryDelayMs: 5_000,
  maxRetryDelayMs: 60_000,
  silenceMs: 800,
};

/** A server's voice connection, which the bot keeps until it leaves. */
interface Kept {
  readonly connection: VoiceConnection;
  /** The voice channel to join again: the one joined, or the one a member moved the bot to. */
  channelId: string;
  /** How many times the bot has joined again on a new connection since it was last ready. */
  attempts: number;
  /** When to give up on the connection, unless it is ready by then. */
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Joins and leaves Discord voice channels, and tells the listener what it
 * hears there.
 *
 * It keeps the connection until it is told to leave. When the connection has
 * been away from ready for `stuckAfterMs`, however it dropped, even when a
 * moderator disconnected the bot, it gives the connection up and joins again
 * on a new one, in the channel the bot was last in, and goes on until one is
 * ready, waiting twice as long each time, from `retryDelayMs` up to
 * `maxRetryDelayMs`. When that channel is gone, or the bot is no longer in
 * the server, it stops, and tells the listener.
 */
export class DiscordVoice implements VoiceConnector {
  private readonly kept = new Map<string, Kept>();

  constructor(
    private readonly client: Pick<Client, 'guilds'>,
    private readonly listener: VoiceListener,
    private readonly logger: Logger,
    private readonly options: DiscordVoiceOptions = DEFAULT_VOICE_OPTIONS
  ) {}

  async join(guildId: GuildId, voiceChannelId: ChannelId): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId.value);
    if (!guild) throw new VoiceConnectionFailed(`The bot is not in server ${guildId.value}`);

    this.stopKeeping(guildId)?.destroy();
    const connection = this.connect(guildId, guild.voiceAdapterCreator as DiscordGatewayAdapterCreator, {
      channelId: voiceChannelId.value,
      attempts: 0,
      readyWithinMs: this.options.stuckAfterMs,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, this.options.readyTimeoutMs);
    } catch (error) {
      const { status } = connection.state;
      if (status === VoiceConnectionStatus.Connecting || status === VoiceConnectionStatus.Signalling) {
        // As the bot always has, a connection still on its way counts as joined.
        this.logger.info('Connection still establishing, continuing anyway', { guildId: guildId.value, status });
        return;
      }
      this.stopKeeping(guildId);
      if (status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      throw new VoiceConnectionFailed(`Failed to join voice channel ${voiceChannelId.value}`, { cause: error });
    }
  }

  async leave(guildId: GuildId): Promise<void> {
    this.stopKeeping(guildId)?.destroy();
    getVoiceConnection(guildId.value)?.destroy();
  }

  /** Join the channel on a new connection, keep it, and give it `readyWithinMs` to be ready. */
  private connect(
    guildId: GuildId,
    adapterCreator: DiscordGatewayAdapterCreator,
    { channelId, attempts, readyWithinMs }: { channelId: string; attempts: number; readyWithinMs: number }
  ): VoiceConnection {
    const connection = joinVoiceChannel({
      guildId: guildId.value,
      channelId,
      adapterCreator,
      selfDeaf: this.options.selfDeaf,
      selfMute: this.options.selfMute,
    });
    const kept: Kept = { connection, channelId, attempts, timer: undefined };
    this.kept.set(guildId.value, kept);
    this.watch(connection, guildId);
    this.listen(connection, guildId);
    this.giveUpAfter(kept, guildId, readyWithinMs);
    return connection;
  }

  /** Stop keeping the server's connection, and return it, if it was kept. */
  private stopKeeping(guildId: GuildId): VoiceConnection | undefined {
    const kept = this.kept.get(guildId.value);
    if (!kept) return undefined;
    clearTimeout(kept.timer);
    this.kept.delete(guildId.value);
    return kept.connection;
  }

  private giveUpAfter(kept: Kept, guildId: GuildId, ms: number): void {
    kept.timer = setTimeout(() => this.joinAgain(guildId), ms);
  }

  /** Give up on the server's connection, which is not ready, and join again on a new one. */
  private joinAgain(guildId: GuildId): void {
    const kept = this.kept.get(guildId.value);
    if (!kept || kept.connection.state.status === VoiceConnectionStatus.Ready) return;

    const ids = { guildId: guildId.value, channelId: kept.channelId };
    const guild = this.client.guilds.cache.get(guildId.value);
    if (!guild?.channels.cache.has(kept.channelId)) {
      this.logger.warn('The voice channel is gone; no longer joining it again', ids);
      this.stopKeeping(guildId)?.destroy();
      this.listener.disconnected(guildId);
      return;
    }

    const attempts = kept.attempts + 1;
    const readyWithinMs = Math.min(this.options.retryDelayMs * 2 ** (attempts - 1), this.options.maxRetryDelayMs);
    this.logger.warn('Voice connection has not come back; joining again', { ...ids, attempt: attempts, readyWithinMs });
    // Not kept while it is destroyed, so that it is not taken for the bot leaving.
    this.stopKeeping(guildId)?.destroy();
    this.connect(guildId, guild.voiceAdapterCreator as DiscordGatewayAdapterCreator, {
      channelId: kept.channelId,
      attempts,
      readyWithinMs,
    });
  }

  private watch(connection: VoiceConnection, guildId: GuildId): void {
    connection.on('stateChange', (from, to) => {
      this.logger.debug('Connection state changed', { guildId: guildId.value, from: from.status, to: to.status });
      const kept = this.kept.get(guildId.value);
      // Given up on, or left: nothing more to do with it.
      if (kept?.connection !== connection) return;

      // A member moved the bot, and the connection follows it there.
      kept.channelId = connection.joinConfig.channelId ?? kept.channelId;
      switch (to.status) {
        case VoiceConnectionStatus.Ready:
          clearTimeout(kept.timer);
          kept.timer = undefined;
          if (kept.attempts > 0) this.logger.info('Voice connection is back', { guildId: guildId.value, attempts: kept.attempts });
          kept.attempts = 0;
          return;
        case VoiceConnectionStatus.Destroyed:
          // Destroyed by someone else, as at shutdown.
          this.stopKeeping(guildId);
          return;
        default:
          if (kept.timer === undefined) this.giveUpAfter(kept, guildId, this.options.stuckAfterMs);
      }
    });
    connection.on('error', (error) => {
      this.logger.error('Connection error', { guildId: guildId.value, error });
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
