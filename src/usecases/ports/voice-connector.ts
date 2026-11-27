import type { ChannelId, GuildId } from '../../domain/discord-ids';

/** Joining a voice channel failed, for a technical reason such as a timeout. */
export class VoiceConnectionFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Connects the bot to voice channels, where it listens to what is said. */
export interface VoiceConnector {
  /**
   * Join the voice channel and start listening. Resolves once connected.
   * @throws VoiceConnectionFailed when the connection cannot be established.
   */
  join(guildId: GuildId, voiceChannelId: ChannelId): Promise<void>;

  /** Leave the server's voice channel. Leaving when not connected does nothing. */
  leave(guildId: GuildId): Promise<void>;

  /** Whether the bot's voice connection in the server is ready: false while it is away, and when there is none. */
  isReady(guildId: GuildId): boolean;

  /**
   * Join the voice channel again at once, on a new connection, without
   * waiting for the next time it would have, and go on joining again until a
   * connection is ready. Resolves once one is ready, or still on its way
   * after a while; a failure is not thrown, but tried again.
   * @throws VoiceConnectionFailed when the bot is not in the server.
   */
  rejoin(guildId: GuildId, voiceChannelId: ChannelId): Promise<void>;
}
