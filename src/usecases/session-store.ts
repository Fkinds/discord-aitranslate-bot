import type { GuildId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';

/**
 * The running translation sessions, one per server, kept in memory.
 *
 * Sessions end when the bot stops, so nothing is persisted. There is one
 * implementation and tests use it too, so it is a class, not a port.
 */
export class SessionStore {
  private readonly sessions = new Map<string, TranslationSession>();

  find(guildId: GuildId): TranslationSession | undefined {
    return this.sessions.get(guildId.value);
  }

  /** Add the session, or replace the server's session with this one. */
  save(session: TranslationSession): void {
    this.sessions.set(session.guildId.value, session);
  }

  /** Remove the server's session. Removing a missing session does nothing. */
  remove(guildId: GuildId): void {
    this.sessions.delete(guildId.value);
  }
}
