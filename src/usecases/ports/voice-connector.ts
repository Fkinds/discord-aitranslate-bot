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
}
