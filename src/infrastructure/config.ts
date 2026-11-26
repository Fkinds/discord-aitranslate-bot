import path from 'node:path';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../domain/language-code';
import { DomainError } from '../domain/shared/domain-error';
import { TranslationLanguages } from '../domain/translation-languages';
import { translatesInto } from './local/languages';
import { ollamaUrlFrom } from './ollama/ollama-host';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type TranslatorConfig =
  /** Without an API key, the SDK finds the credentials: a sign-in with `ant auth login`, or Workload Identity Federation. */
  | { readonly kind: 'claude'; readonly apiKey: string | undefined; readonly modelsDir: string }
  | { readonly kind: 'gemini'; readonly apiKey: string; readonly model: string }
  /** `ollamaUrl` is where Ollama is, read from OLLAMA_HOST as Ollama reads it. */
  | { readonly kind: 'translategemma'; readonly ollamaUrl: string; readonly model: string; readonly modelsDir: string }
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

/** The TranslateGemma model when TRANSLATEGEMMA_MODEL is unset: the 12B one, which translated better than 4B in the trials (#86). */
export const DEFAULT_TRANSLATEGEMMA_MODEL = 'translategemma:12b';

/** Where the local models are kept when MODELS_DIR is unset, relative to the working directory. */
export const DEFAULT_MODELS_DIR = 'models';

type Env = Readonly<Record<string, string | undefined>>;

type TranslatorKind = TranslatorConfig['kind'];

/** The values of TRANSLATOR; the first is the default. */
const TRANSLATORS: readonly TranslatorKind[] = ['claude', 'gemini', 'translategemma', 'fake'];

/** The translators that hear speech with Whisper, which tells only the languages offered in the commands apart. */
const HEARING_WITH_WHISPER: readonly TranslatorKind[] = ['claude', 'translategemma'];

function isTranslatorKind(value: string): value is TranslatorKind {
  return (TRANSLATORS as readonly string[]).includes(value);
}

/**
 * The variable that holds the API key each translator needs, if it needs one.
 * Claude needs none: without ANTHROPIC_API_KEY, its SDK finds other credentials.
 */
const API_KEYS: Readonly<Record<TranslatorKind, string | undefined>> = {
  claude: undefined,
  gemini: 'GOOGLE_GEMINI_API_KEY',
  translategemma: undefined,
  fake: undefined,
};

/**
 * Read the settings from environment variables. An empty variable counts as
 * unset, as it always has. A relative MODELS_DIR is taken from `workingDir`.
 *
 * @throws ConfigError naming every required variable that is missing, or the
 *   first malformed one.
 */
export function readConfig(env: Env, workingDir: string): Config {
  const value = (name: string): string | undefined => env[name] || undefined;

  const kind = value('TRANSLATOR') ?? TRANSLATORS[0]!;
  if (!isTranslatorKind(kind)) {
    throw new ConfigError(`TRANSLATOR must be one of ${TRANSLATORS.join(', ')}, got ${JSON.stringify(kind)}`);
  }

  const apiKey = API_KEYS[kind];
  const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', ...(apiKey === undefined ? [] : [apiKey])];
  const missing = required.filter((name) => value(name) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const defaultLanguages = languagesFrom(value('DEFAULT_TARGET_LANGUAGE') ?? 'ja');
  const untranslatable = defaultLanguages.languages.filter((language) => !translatesInto(language));
  if (HEARING_WITH_WHISPER.includes(kind) && untranslatable.length > 0) {
    throw new ConfigError(
      `DEFAULT_TARGET_LANGUAGE: TRANSLATOR=${kind} does not translate into ${untranslatable.join(', ')}. ` +
        `Use the languages offered in the commands (${SUPPORTED_LANGUAGES.join(', ')}), or TRANSLATOR=gemini`
    );
  }

  return {
    discordToken: value('DISCORD_BOT_TOKEN')!,
    discordClientId: value('DISCORD_CLIENT_ID')!,
    translator: translatorFrom(kind, value, workingDir),
    defaultLanguages,
    logLevel: logLevelFrom(value('LOG_LEVEL') ?? 'info'),
  };
}

function translatorFrom(
  kind: TranslatorKind,
  value: (name: string) => string | undefined,
  workingDir: string
): TranslatorConfig {
  switch (kind) {
    case 'claude':
      return { kind, apiKey: value('ANTHROPIC_API_KEY'), modelsDir: modelsDirFrom(value, workingDir) };
    case 'gemini':
      return { kind, apiKey: value('GOOGLE_GEMINI_API_KEY')!, model: value('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL };
    case 'translategemma':
      return { kind, ...translateGemmaFrom(value), modelsDir: modelsDirFrom(value, workingDir) };
    case 'fake':
      return { kind };
  }
}

/** Where Ollama is, from OLLAMA_HOST, and the TranslateGemma model it runs. */
function translateGemmaFrom(value: (name: string) => string | undefined): { ollamaUrl: string; model: string } {
  try {
    return { ollamaUrl: ollamaUrlFrom(value('OLLAMA_HOST')).href, model: value('TRANSLATEGEMMA_MODEL') ?? DEFAULT_TRANSLATEGEMMA_MODEL };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new ConfigError(error.message, { cause: error });
  }
}

function modelsDirFrom(value: (name: string) => string | undefined, workingDir: string): string {
  return path.resolve(workingDir, value('MODELS_DIR') ?? DEFAULT_MODELS_DIR);
}

/** The settings for `pnpm models:download`, which needs no Discord or Gemini keys. */
export interface ModelsConfig {
  /** An absolute path. */
  readonly modelsDir: string;
  /** With TRANSLATOR=translategemma, the model for Ollama to pull, and where Ollama is. */
  readonly translateGemma?: { readonly ollamaUrl: string; readonly model: string };
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
    ...(value('TRANSLATOR') === 'translategemma' ? { translateGemma: translateGemmaFrom(value) } : {}),
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
