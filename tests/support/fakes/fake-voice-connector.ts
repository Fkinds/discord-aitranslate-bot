import type { ChannelId, GuildId } from '../../../src/domain/discord-ids';
import type { VoiceConnector } from '../../../src/usecases/ports/voice-connector';

/** A VoiceConnector that records calls and can be told to fail, to wait, or that a connection dropped. */
export class FakeVoiceConnector implements VoiceConnector {
  readonly joins: Array<{ guildId: string; voiceChannelId: string }> = [];
  readonly leaves: string[] = [];
  readonly rejoins: Array<{ guildId: string; voiceChannelId: string }> = [];
  private readonly dropped = new Set<string>();
  private joinError: Error | undefined;
  private leaveError: Error | undefined;
  private joinGate: Promise<void> = Promise.resolve();

  /** Make the next join fail with this error. */
  failNextJoin(error: Error): void {
    this.joinError = error;
  }

  /** Make the next leave fail with this error. */
  failNextLeave(error: Error): void {
    this.leaveError = error;
  }

  /** Make the server's connection not ready, as when it dropped, until the bot joins again. */
  drop(guildId: GuildId): void {
    this.dropped.add(guildId.value);
  }

  /** Keep joins pending until the returned function is called. */
  holdJoins(): () => void {
    let release!: () => void;
    this.joinGate = new Promise((resolve) => (release = resolve));
    return release;
  }

  async join(guildId: GuildId, voiceChannelId: ChannelId): Promise<void> {
    this.joins.push({ guildId: guildId.value, voiceChannelId: voiceChannelId.value });
    await this.joinGate;
    const error = this.joinError;
    this.joinError = undefined;
    if (error) throw error;
  }

  isReady(guildId: GuildId): boolean {
    return !this.dropped.has(guildId.value);
  }

  async rejoin(guildId: GuildId, voiceChannelId: ChannelId): Promise<void> {
    this.rejoins.push({ guildId: guildId.value, voiceChannelId: voiceChannelId.value });
    this.dropped.delete(guildId.value);
  }

  async leave(guildId: GuildId): Promise<void> {
    this.leaves.push(guildId.value);
    const error = this.leaveError;
    this.leaveError = undefined;
    if (error) throw error;
  }
}
