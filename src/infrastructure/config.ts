import path from 'node:path';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../domain/language-code';
import { DomainError } from '../domain/shared/domain-error';
import { TranslationLanguages } from '../domain/translation-languages';
import { translatesInto } from './local/hy-mt-translator';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type TranslatorConfig =
  | { readonly kind: 'local'; readonly modelsDir: string }
  | { readonly kind: 'gemini'; readonly apiKey: string; readonly model: string }
  | { readonly kind: 'fake' };

export interface Config {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly translator: TranslatorConfig;
  /** The languages /translate-join translates into when none are chosen. */
  readonly defaultLanguages: TranslationLanguages;
  readonly logLevel: LogLevel;
}

/** The settings are missing or malformed; the message says which and how. */
export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The Gemini model when GEMINI_MODEL is unset: the newest stable Flash model
 * that takes audio, as of 2026-11.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/** Where the local models are kept when MODELS_DIR is unset, relative to the working directory. */
export const DEFAULT_MODELS_DIR = 'models';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Read the settings from environment variables. An empty variable counts as
 * unset, as it always has. A relative MODELS_DIR is taken from `workingDir`.
 *
 * @throws ConfigError naming every required variable that is missing, or the
 *   first malformed one.
 */
export function readConfig(env: Env, workingDir: string): Config {
  const value = (name: string): string | undefined => env[name] || undefined;

  const translatorKind = value('TRANSLATOR') ?? 'local';
  if (translatorKind !== 'local' && translatorKind !== 'gemini' && translatorKind !== 'fake') {
    throw new ConfigError(`TRANSLATOR must be "local", "gemini" or "fake", got ${JSON.stringify(translatorKind)}`);
  }

  const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', ...(translatorKind === 'gemini' ? ['GOOGLE_GEMINI_API_KEY'] : [])];
  const missing = required.filter((name) => value(name) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const defaultLanguages = languagesFrom(value('DEFAULT_TARGET_LANGUAGE') ?? 'ja');
  const untranslatable = defaultLanguages.languages.filter((language) => !translatesInto(language));
  if (translatorKind === 'local' && untranslatable.length > 0) {
    throw new ConfigError(
      `DEFAULT_TARGET_LANGUAGE: the local translator does not translate into ${untranslatable.join(', ')}. ` +
        `Use the languages offered in the commands (${SUPPORTED_LANGUAGES.join(', ')}), or TRANSLATOR=gemini`
    );
  }

  return {
    discordToken: value('DISCORD_BOT_TOKEN')!,
    discordClientId: value('DISCORD_CLIENT_ID')!,
    translator: translatorFrom(translatorKind, value, workingDir),
    defaultLanguages,
    logLevel: logLevelFrom(value('LOG_LEVEL') ?? 'info'),
  };
}

function translatorFrom(
  kind: TranslatorConfig['kind'],
  value: (name: string) => string | undefined,
  workingDir: string
): TranslatorConfig {
  switch (kind) {
    case 'local':
      return { kind, modelsDir: modelsDirFrom(value, workingDir) };
    case 'gemini':
      return { kind, apiKey: value('GOOGLE_GEMINI_API_KEY')!, model: value('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL };
    case 'fake':
      return { kind };
  }
}

function modelsDirFrom(value: (name: string) => string | undefined, workingDir: string): string {
  return path.resolve(workingDir, value('MODELS_DIR') ?? DEFAULT_MODELS_DIR);
}

/** The settings for `pnpm models:download`, which needs no Discord or Gemini keys. */
export interface ModelsConfig {
  /** An absolute path. */
  readonly modelsDir: string;
  readonly logLevel: LogLevel;
}

/**
 * Read the settings for downloading the local models. A relative MODELS_DIR is
 * taken from `workingDir`.
 *
 * @throws ConfigError when a setting is malformed.
 */
export function readModelsConfig(env: Env, workingDir: string): ModelsConfig {
  const value = (name: string): string | undefined => env[name] || undefined;
  return {
    modelsDir: modelsDirFrom(value, workingDir),
    logLevel: logLevelFrom(value('LOG_LEVEL') ?? 'info'),
  };
}

/** One language tag, or two separated by a comma for a pair, such as "ja,ko". */
function languagesFrom(value: string): TranslationLanguages {
  const tags = value.split(',').map((tag) => tag.trim());
  if (tags.length > 2) {
    throw new ConfigError(`DEFAULT_TARGET_LANGUAGE takes one language or two, got ${JSON.stringify(value)}`);
  }
  try {
    const [first, second] = tags.map((tag) => LanguageCode.of(tag));
    return TranslationLanguages.of(first!, second);
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
