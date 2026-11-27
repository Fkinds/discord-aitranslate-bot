import type { ChannelId, GuildId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';
import type { SessionStore } from './session-store';

export interface RecordChannelMoveCommand {
  readonly guildId: GuildId;
  /** The voice channel the bot is in now. */
  readonly voiceChannelId: ChannelId;
}

export type RecordChannelMoveResult =
  | { readonly kind: 'moved'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' };

/**
 * Record that the bot is in another voice channel of the server, where a
 * member moved it, so that the status names that channel, and the bot joins
 * it again when its connection is lost. It goes on translating there.
 */
export class RecordChannelMove {
  constructor(private readonly sessions: SessionStore) {}

  execute(command: RecordChannelMoveCommand): RecordChannelMoveResult {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    const moved = session.movedTo(command.voiceChannelId);
    this.sessions.save(moved);
    return { kind: 'moved', session: moved };
  }
}
