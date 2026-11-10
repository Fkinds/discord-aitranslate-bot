import { LanguageCode } from '../domain/language-code';
import { DomainError } from '../domain/shared/domain-error';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type TranslatorConfig =
  | { readonly kind: 'gemini'; readonly apiKey: string; readonly model: string }
  | { readonly kind: 'fake' };

export interface Config {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly translator: TranslatorConfig;
  readonly defaultTargetLanguage: LanguageCode;
  readonly logLevel: LogLevel;
}

/** The settings are missing or malformed; the message says which and how. */
export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Read the settings from environment variables. An empty variable counts as
 * unset, as it always has.
 *
 * @throws ConfigError naming every required variable that is missing, or the
 *   first malformed one.
 */
export function readConfig(env: Env): Config {
  const value = (name: string): string | undefined => env[name] || undefined;

  const translatorKind = value('TRANSLATOR') ?? 'gemini';
  if (translatorKind !== 'gemini' && translatorKind !== 'fake') {
    throw new ConfigError(`TRANSLATOR must be "gemini" or "fake", got ${JSON.stringify(translatorKind)}`);
  }

  const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', ...(translatorKind === 'gemini' ? ['GOOGLE_GEMINI_API_KEY'] : [])];
  const missing = required.filter((name) => value(name) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    discordToken: value('DISCORD_BOT_TOKEN')!,
    discordClientId: value('DISCORD_CLIENT_ID')!,
    translator:
      translatorKind === 'gemini'
        ? { kind: 'gemini', apiKey: value('GOOGLE_GEMINI_API_KEY')!, model: value('GEMINI_MODEL') ?? 'gemini-2.0-flash-exp' }
        : { kind: 'fake' },
    defaultTargetLanguage: languageFrom(value('DEFAULT_TARGET_LANGUAGE') ?? 'ja'),
    logLevel: logLevelFrom(value('LOG_LEVEL') ?? 'info'),
  };
}

function languageFrom(tag: string): LanguageCode {
  try {
    return LanguageCode.of(tag);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    throw new ConfigError(`DEFAULT_TARGET_LANGUAGE: ${error.message}`, { cause: error });
  }
}

function logLevelFrom(level: string): LogLevel {
  const known: readonly string[] = LOG_LEVELS;
  if (!known.includes(level)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got ${JSON.stringify(level)}`);
  }
  return level as LogLevel;
}
