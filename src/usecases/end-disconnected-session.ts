import type { GuildId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';
import type { SessionStore } from './session-store';

export interface EndDisconnectedSessionCommand {
  readonly guildId: GuildId;
}

export type EndDisconnectedSessionResult =
  | { readonly kind: 'ended'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' };

/**
 * End the server's session after the bot was disconnected from the voice
 * channel for good, for example when a moderator removed it. The connection
 * is already gone, so this does not leave; it only ends the session.
 */
export class EndDisconnectedSession {
  constructor(private readonly sessions: SessionStore) {}

  execute(command: EndDisconnectedSessionCommand): EndDisconnectedSessionResult {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    this.sessions.remove(session.guildId);
    return { kind: 'ended', session };
  }
}
