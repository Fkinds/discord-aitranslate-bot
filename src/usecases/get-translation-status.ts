import type { GuildId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';
import type { Clock } from './ports/clock';
import type { SessionStore } from './session-store';

export interface GetTranslationStatusQuery {
  readonly guildId: GuildId;
}

export type GetTranslationStatusResult =
  | { readonly kind: 'running'; readonly session: TranslationSession; readonly uptimeMs: number }
  | { readonly kind: 'notRunning' };

/** Report the server's translation session, if one is running. */
export class GetTranslationStatus {
  constructor(
    private readonly sessions: SessionStore,
    private readonly clock: Clock
  ) {}

  execute(query: GetTranslationStatusQuery): GetTranslationStatusResult {
    const session = this.sessions.find(query.guildId);
    if (!session) return { kind: 'notRunning' };
    return { kind: 'running', session, uptimeMs: session.uptimeMs(this.clock()) };
  }
}
