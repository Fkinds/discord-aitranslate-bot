import type { GuildId } from '../domain/discord-ids';
import type { LanguageCode } from '../domain/language-code';
import { TranslationLanguages } from '../domain/translation-languages';
import type { TranslationSession } from '../domain/translation-session';
import type { SessionStore } from './session-store';

export interface ChangeLanguagesCommand {
  readonly guildId: GuildId;
  readonly language: LanguageCode;
  /** The other language of a pair; one language when omitted. */
  readonly secondLanguage?: LanguageCode;
}

export type ChangeLanguagesResult =
  | { readonly kind: 'changed'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' }
  | { readonly kind: 'sameLanguageTwice' };

/** Translate into other languages from now on: one language, or a pair. */
export class ChangeLanguages {
  constructor(private readonly sessions: SessionStore) {}

  execute(command: ChangeLanguagesCommand): ChangeLanguagesResult {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    const { language, secondLanguage } = command;
    if (secondLanguage?.equals(language)) return { kind: 'sameLanguageTwice' };

    const changed = session.changeLanguages(TranslationLanguages.of(language, secondLanguage));
    this.sessions.save(changed);
    return { kind: 'changed', session: changed };
  }
}
