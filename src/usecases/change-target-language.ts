import type { GuildId } from '../domain/discord-ids';
import type { LanguageCode } from '../domain/language-code';
import type { TranslationSession } from '../domain/translation-session';
import type { SessionStore } from './session-store';

export interface ChangeTargetLanguageCommand {
  readonly guildId: GuildId;
  readonly language: LanguageCode;
}

export type ChangeTargetLanguageResult =
  | { readonly kind: 'changed'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' };

/** Translate into another language from now on. */
export class ChangeTargetLanguage {
  constructor(private readonly sessions: SessionStore) {}

  execute(command: ChangeTargetLanguageCommand): ChangeTargetLanguageResult {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    const changed = session.changeTargetLanguage(command.language);
    this.sessions.save(changed);
    return { kind: 'changed', session: changed };
  }
}
