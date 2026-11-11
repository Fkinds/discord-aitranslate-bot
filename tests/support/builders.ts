import { ChannelId, GuildId } from '../../src/domain/discord-ids';
import { LanguageCode } from '../../src/domain/language-code';
import { TranslationLanguages } from '../../src/domain/translation-languages';
import { TranslationSession } from '../../src/domain/translation-session';

export const STARTED_AT = new Date('2026-11-11T09:00:00Z');

/** A running session; override what the test is about. `second` makes `language` one of a pair. */
export function aSession(
  overrides: { guild?: string; voice?: string; text?: string; language?: string; second?: string; startedAt?: Date } = {}
): TranslationSession {
  const first = LanguageCode.of(overrides.language ?? 'ja');
  return TranslationSession.start({
    guildId: GuildId.of(overrides.guild ?? '1'),
    voiceChannelId: ChannelId.of(overrides.voice ?? '10'),
    textChannelId: ChannelId.of(overrides.text ?? '20'),
    languages: TranslationLanguages.of(first, overrides.second ? LanguageCode.of(overrides.second) : undefined),
    startedAt: overrides.startedAt ?? STARTED_AT,
  });
}

/** A clock fixed at the given time. */
export function fixedClock(at: Date): () => Date {
  return () => new Date(at);
}
