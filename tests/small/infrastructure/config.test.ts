import { describe, it, expect } from '@jest/globals';
import { ConfigError, readConfig, readModelsConfig } from '../../../src/infrastructure/config';

const CWD = '/srv/bot';

const REQUIRED = {
  DISCORD_BOT_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123',
  ANTHROPIC_API_KEY: 'anthropic-key',
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

  it('falls back to the defaults: hearing speech on this machine, with the models in models/, and translating with Claude', () => {
    const config = readConfig(REQUIRED, CWD);

    expect(config.translator).toEqual({ kind: 'claude', apiKey: 'anthropic-key', modelsDir: '/srv/bot/models' });
    expect(config.defaultLanguages.toString()).toBe('ja');
    expect(config.logLevel).toBe('info');
  });

  it('takes an empty variable as unset, as it always has', () => {
    const config = readConfig({ ...REQUIRED, TRANSLATOR: '', MODELS_DIR: '', DEFAULT_TARGET_LANGUAGE: '', LOG_LEVEL: '' }, CWD);

    expect(config.translator).toEqual({ kind: 'claude', apiKey: 'anthropic-key', modelsDir: '/srv/bot/models' });
    expect(readConfig({ ...REQUIRED, TRANSLATOR: 'gemini', GEMINI_MODEL: '' }, CWD).translator).toMatchObject({
      model: 'gemini-3.8-flash',
    });
    expect(config.defaultLanguages.toString()).toBe('ja');
    expect(() => readConfig({ ...REQUIRED, DISCORD_BOT_TOKEN: '' }, CWD)).toThrow('DISCORD_BOT_TOKEN');
  });

  it.each([
    ['claude', ''],
    ['gemini', ', GOOGLE_GEMINI_API_KEY'],
  ])('names every missing variable at once, with the API key TRANSLATOR=%s needs', (translator, apiKey) => {
    expect(() => readConfig({ TRANSLATOR: translator }, CWD)).toThrow(
      new ConfigError(`Missing required environment variables: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID${apiKey}`)
    );
  });

  it('leaves Claude to the credentials its SDK finds when there is no Anthropic API key', () => {
    const { ANTHROPIC_API_KEY: _key, ...withoutKey } = REQUIRED;

    expect(readConfig(withoutKey, CWD).translator).toEqual({ kind: 'claude', apiKey: undefined, modelsDir: '/srv/bot/models' });
    expect(readConfig({ ...withoutKey, ANTHROPIC_API_KEY: '' }, CWD).translator).toMatchObject({ apiKey: undefined });
  });

  it('needs no API key with TRANSLATOR=fake', () => {
    const { ANTHROPIC_API_KEY: _anthropic, GOOGLE_GEMINI_API_KEY: _gemini, ...withoutKeys } = REQUIRED;

    expect(readConfig({ ...withoutKeys, TRANSLATOR: 'fake' }, CWD).translator).toEqual({ kind: 'fake' });
  });

  it('translates with TranslateGemma on Ollama on this machine by default, needing no API key', () => {
    const { ANTHROPIC_API_KEY: _anthropic, GOOGLE_GEMINI_API_KEY: _gemini, ...withoutKeys } = REQUIRED;

    expect(readConfig({ ...withoutKeys, TRANSLATOR: 'translategemma' }, CWD).translator).toEqual({
      kind: 'translategemma',
      ollamaUrl: 'http://127.0.0.1:11434/',
      model: 'translategemma:12b',
      modelsDir: '/srv/bot/models',
    });
  });

  it('reads OLLAMA_HOST as Ollama does, and TRANSLATEGEMMA_MODEL', () => {
    const config = readConfig(
      { ...REQUIRED, TRANSLATOR: 'translategemma', OLLAMA_HOST: 'gpu-box', TRANSLATEGEMMA_MODEL: 'translategemma:4b' },
      CWD
    );

    expect(config.translator).toMatchObject({ ollamaUrl: 'http://gpu-box:11434/', model: 'translategemma:4b' });
  });

  it('rejects an OLLAMA_HOST that is not http or https at startup', () => {
    const reading = () => readConfig({ ...REQUIRED, TRANSLATOR: 'translategemma', OLLAMA_HOST: 'tcp://gpu-box' }, CWD);

    expect(reading).toThrow(ConfigError);
    expect(reading).toThrow('OLLAMA_HOST must be http or https, got "tcp://gpu-box"');
  });

  it.each([
    ['an absolute directory as it is', '/var/cache/models', '/var/cache/models'],
    ['a relative directory from the working directory', '../shared/models', '/srv/shared/models'],
  ])('takes MODELS_DIR, %s', (_case, modelsDir, expected) => {
    expect(readConfig({ ...REQUIRED, MODELS_DIR: modelsDir }, CWD).translator).toMatchObject({ modelsDir: expected });
  });

  it.each([
    ['an unknown translator, rather than guessing', 'openai'],
    ['the local translator, which is gone', 'local'],
  ])('rejects %s', (_case, translator) => {
    expect(() => readConfig({ ...REQUIRED, TRANSLATOR: translator }, CWD)).toThrow(
      new ConfigError(`TRANSLATOR must be one of claude, gemini, translategemma, fake, got "${translator}"`)
    );
  });

  it('takes any well-formed language tag, in canonical form, for Gemini', () => {
    const config = readConfig({ ...REQUIRED, TRANSLATOR: 'gemini', DEFAULT_TARGET_LANGUAGE: 'ZH-tw' }, CWD);

    expect(config.defaultLanguages.toString()).toBe('zh-TW');
  });

  it.each([
    ['claude', 'zh-TW'],
    ['claude', 'ja,vi'],
    ['translategemma', 'zh-TW'],
  ])(
    'rejects at startup, for TRANSLATOR=%s, %j, which the commands do not offer and Whisper cannot tell',
    (translator, languages) => {
      expect(() => readConfig({ ...REQUIRED, TRANSLATOR: translator, DEFAULT_TARGET_LANGUAGE: languages }, CWD)).toThrow(
        new RegExp(
          `^DEFAULT_TARGET_LANGUAGE: TRANSLATOR=${translator} does not translate into (zh-TW|vi)\\. ` +
            'Use the languages offered in the commands \\(ja, en, ko, zh, es, fr, de, it, pt, ru\\), or TRANSLATOR=gemini$'
        )
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

  it('records no one by default', () => {
    expect(readConfig(REQUIRED, CWD).recording).toBeUndefined();
  });

  it("records a member's utterances with RECORD_SPEECH_OF and RECORDINGS_DIR, from the working directory", () => {
    const { recording } = readConfig({ ...REQUIRED, RECORD_SPEECH_OF: '533849889923399690', RECORDINGS_DIR: 'recordings' }, CWD);

    expect(recording?.userId.value).toBe('533849889923399690');
    expect(recording?.dir).toBe('/srv/bot/recordings');
  });

  it.each([
    ['RECORD_SPEECH_OF alone', { RECORD_SPEECH_OF: '533849889923399690' }],
    ['RECORDINGS_DIR alone', { RECORDINGS_DIR: 'recordings' }],
  ])('rejects %s at startup', (_, variables) => {
    expect(() => readConfig({ ...REQUIRED, ...variables }, CWD)).toThrow(
      'RECORD_SPEECH_OF and RECORDINGS_DIR go together: set both to record, or neither'
    );
  });

  it('rejects a RECORD_SPEECH_OF that is not a Discord user ID at startup', () => {
    expect(() => readConfig({ ...REQUIRED, RECORD_SPEECH_OF: 'alice', RECORDINGS_DIR: 'recordings' }, CWD)).toThrow(
      /^RECORD_SPEECH_OF: /
    );
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

  it('with TRANSLATOR=translategemma, also names the model for Ollama to pull, and where Ollama is', () => {
    expect(readModelsConfig({ TRANSLATOR: 'translategemma', OLLAMA_HOST: ':11500' }, '/srv/bot').translateGemma).toEqual({
      ollamaUrl: 'http://127.0.0.1:11500/',
      model: 'translategemma:12b',
    });
    expect(readModelsConfig({ TRANSLATOR: 'claude', OLLAMA_HOST: ':11500' }, '/srv/bot').translateGemma).toBeUndefined();
    expect(() => readModelsConfig({ TRANSLATOR: 'translategemma', OLLAMA_HOST: 'tcp://x' }, '/srv/bot')).toThrow(ConfigError);
  });

  it('reads the log level, rejecting one not listed in .env.example', () => {
    expect(readModelsConfig({ LOG_LEVEL: 'debug' }, '/srv/bot').logLevel).toBe('debug');
    expect(() => readModelsConfig({ LOG_LEVEL: 'verbose' }, '/srv/bot')).toThrow(ConfigError);
  });
});
