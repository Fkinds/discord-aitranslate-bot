import type { ChannelId, GuildId } from '../../../src/domain/discord-ids';
import type { VoiceConnector } from '../../../src/usecases/ports/voice-connector';

/** A VoiceConnector that records calls and can be told to fail or to wait. */
export class FakeVoiceConnector implements VoiceConnector {
  readonly joins: Array<{ guildId: string; voiceChannelId: string }> = [];
  readonly leaves: string[] = [];
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

  async leave(guildId: GuildId): Promise<void> {
    this.leaves.push(guildId.value);
    const error = this.leaveError;
    this.leaveError = undefined;
    if (error) throw error;
  }
}
