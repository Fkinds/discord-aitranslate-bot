import { describe, it, expect } from '@jest/globals';
import { ConfigError, readConfig, readModelsConfig } from '../../../src/infrastructure/config';

const CWD = '/srv/bot';

const REQUIRED = {
  DISCORD_BOT_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123',
  GOOGLE_GEMINI_API_KEY: 'key',
};

describe('readConfig', () => {
  it('reads every setting', () => {
    const config = readConfig(
      { ...REQUIRED, TRANSLATOR: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', DEFAULT_TARGET_LANGUAGE: 'en', LOG_LEVEL: 'debug' },
      CWD
    );

    expect(config.discordToken).toBe('token');
    expect(config.discordClientId).toBe('123');
    expect(config.translator).toEqual({ kind: 'gemini', apiKey: 'key', model: 'gemini-2.5-flash' });
    expect(config.defaultLanguages.toString()).toBe('en');
    expect(config.logLevel).toBe('debug');
  });

  it('falls back to the defaults: translating on this machine, with the models in models/', () => {
    const config = readConfig(REQUIRED, CWD);

    expect(config.translator).toEqual({ kind: 'local', modelsDir: '/srv/bot/models' });
    expect(config.defaultLanguages.toString()).toBe('ja');
    expect(config.logLevel).toBe('info');
  });

  it('takes an empty variable as unset, as it always has', () => {
    const config = readConfig({ ...REQUIRED, TRANSLATOR: '', MODELS_DIR: '', DEFAULT_TARGET_LANGUAGE: '', LOG_LEVEL: '' }, CWD);

    expect(config.translator).toEqual({ kind: 'local', modelsDir: '/srv/bot/models' });
    expect(readConfig({ ...REQUIRED, TRANSLATOR: 'gemini', GEMINI_MODEL: '' }, CWD).translator).toMatchObject({
      model: 'gemini-3.8-flash',
    });
    expect(config.defaultLanguages.toString()).toBe('ja');
    expect(() => readConfig({ ...REQUIRED, DISCORD_BOT_TOKEN: '' }, CWD)).toThrow('DISCORD_BOT_TOKEN');
  });

  it('names every missing variable at once', () => {
    expect(() => readConfig({ TRANSLATOR: 'gemini' }, CWD)).toThrow(
      new ConfigError('Missing required environment variables: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, GOOGLE_GEMINI_API_KEY')
    );
  });

  it.each(['local', 'fake'])('needs no Gemini API key with TRANSLATOR=%s', (translator) => {
    const { GOOGLE_GEMINI_API_KEY: _key, ...withoutKey } = REQUIRED;

    expect(readConfig({ ...withoutKey, TRANSLATOR: translator }, CWD).translator.kind).toBe(translator);
  });

  it.each([
    ['an absolute directory as it is', '/var/cache/models', '/var/cache/models'],
    ['a relative directory from the working directory', '../shared/models', '/srv/shared/models'],
  ])('takes MODELS_DIR, %s', (_case, modelsDir, expected) => {
    expect(readConfig({ ...REQUIRED, MODELS_DIR: modelsDir }, CWD).translator).toEqual({ kind: 'local', modelsDir: expected });
  });

  it('rejects an unknown translator rather than guessing', () => {
    expect(() => readConfig({ ...REQUIRED, TRANSLATOR: 'openai' }, CWD)).toThrow(ConfigError);
  });

  it('takes any well-formed language tag, in canonical form, for Gemini', () => {
    const config = readConfig({ ...REQUIRED, TRANSLATOR: 'gemini', DEFAULT_TARGET_LANGUAGE: 'ZH-tw' }, CWD);

    expect(config.defaultLanguages.toString()).toBe('zh-TW');
  });

  it.each(['zh-TW', 'ja,vi'])(
    'rejects %j at startup for the local translator, which translates only into the languages the commands offer',
    (languages) => {
      expect(() => readConfig({ ...REQUIRED, DEFAULT_TARGET_LANGUAGE: languages }, CWD)).toThrow(
        /^DEFAULT_TARGET_LANGUAGE: the local translator does not translate into (zh-TW|vi)\. Use the languages offered in the commands \(ja, en, ko, zh, es, fr, de, it, pt, ru\), or TRANSLATOR=gemini$/
      );
    }
  );

  it.each([
    ['ja,ko', 'ja,ko'],
    [' ja , KO ', 'ja,ko'],
  ])('takes a pair of languages, %j', (value, languages) => {
    expect(readConfig({ ...REQUIRED, DEFAULT_TARGET_LANGUAGE: value }, CWD).defaultLanguages.toString()).toBe(languages);
  });

  it.each([
    ['ja,ja', /^DEFAULT_TARGET_LANGUAGE: A pair needs two different languages/],
    ['ja,ko,en', /^DEFAULT_TARGET_LANGUAGE takes one language or two/],
    ['ja,', /^DEFAULT_TARGET_LANGUAGE: /],
  ])('rejects %j at startup', (value, message) => {
    expect(() => readConfig({ ...REQUIRED, DEFAULT_TARGET_LANGUAGE: value }, CWD)).toThrow(message);
  });

  it('rejects a malformed language tag at startup', () => {
    expect(() => readConfig({ ...REQUIRED, DEFAULT_TARGET_LANGUAGE: 'ja_JP' }, CWD)).toThrow(/^DEFAULT_TARGET_LANGUAGE: /);
  });

  it('rejects a log level other than those listed in .env.example', () => {
    expect(() => readConfig({ ...REQUIRED, LOG_LEVEL: 'verbose' }, CWD)).toThrow(ConfigError);
  });
});

describe('readModelsConfig', () => {
  it('keeps the models in models/ under the working directory, needing no keys', () => {
    expect(readModelsConfig({}, '/srv/bot')).toEqual({ modelsDir: '/srv/bot/models', logLevel: 'info' });
  });

  it.each([
    ['an absolute directory as it is', '/var/cache/models', '/var/cache/models'],
    ['a relative directory from the working directory', '../shared/models', '/srv/shared/models'],
    ['an empty one as unset', '', '/srv/bot/models'],
  ])('takes %s', (_case, modelsDir, expected) => {
    expect(readModelsConfig({ MODELS_DIR: modelsDir }, '/srv/bot').modelsDir).toBe(expected);
  });

  it('reads the log level, rejecting one not listed in .env.example', () => {
    expect(readModelsConfig({ LOG_LEVEL: 'debug' }, '/srv/bot').logLevel).toBe('debug');
    expect(() => readModelsConfig({ LOG_LEVEL: 'verbose' }, '/srv/bot')).toThrow(ConfigError);
  });
});
