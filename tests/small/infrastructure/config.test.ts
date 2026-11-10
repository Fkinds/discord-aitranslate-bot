import { describe, it, expect } from '@jest/globals';
import { ConfigError, readConfig } from '../../../src/infrastructure/config';

const REQUIRED = {
  DISCORD_BOT_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123',
  GOOGLE_GEMINI_API_KEY: 'key',
};

describe('readConfig', () => {
  it('reads every setting', () => {
    const config = readConfig({
      ...REQUIRED,
      TRANSLATOR: 'gemini',
      GEMINI_MODEL: 'gemini-2.5-flash',
      DEFAULT_TARGET_LANGUAGE: 'en',
      LOG_LEVEL: 'debug',
    });

    expect(config.discordToken).toBe('token');
    expect(config.discordClientId).toBe('123');
    expect(config.translator).toEqual({ kind: 'gemini', apiKey: 'key', model: 'gemini-2.5-flash' });
    expect(config.defaultTargetLanguage.tag).toBe('en');
    expect(config.logLevel).toBe('debug');
  });

  it('falls back to the defaults the bot has always had', () => {
    const config = readConfig(REQUIRED);

    expect(config.translator).toEqual({ kind: 'gemini', apiKey: 'key', model: 'gemini-2.0-flash-exp' });
    expect(config.defaultTargetLanguage.tag).toBe('ja');
    expect(config.logLevel).toBe('info');
  });

  it('takes an empty variable as unset, as it always has', () => {
    const config = readConfig({ ...REQUIRED, TRANSLATOR: '', GEMINI_MODEL: '', DEFAULT_TARGET_LANGUAGE: '', LOG_LEVEL: '' });

    expect(config.translator).toMatchObject({ kind: 'gemini', model: 'gemini-2.0-flash-exp' });
    expect(config.defaultTargetLanguage.tag).toBe('ja');
    expect(() => readConfig({ ...REQUIRED, DISCORD_BOT_TOKEN: '' })).toThrow('DISCORD_BOT_TOKEN');
  });

  it('names every missing variable at once', () => {
    expect(() => readConfig({})).toThrow(
      new ConfigError('Missing required environment variables: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, GOOGLE_GEMINI_API_KEY')
    );
  });

  it('needs no Gemini API key with the placeholder translator', () => {
    const { GOOGLE_GEMINI_API_KEY: _key, ...withoutKey } = REQUIRED;

    expect(readConfig({ ...withoutKey, TRANSLATOR: 'fake' }).translator).toEqual({ kind: 'fake' });
  });

  it('rejects an unknown translator rather than guessing', () => {
    expect(() => readConfig({ ...REQUIRED, TRANSLATOR: 'openai' })).toThrow(ConfigError);
  });

  it('takes any well-formed language tag, in canonical form', () => {
    expect(readConfig({ ...REQUIRED, DEFAULT_TARGET_LANGUAGE: 'ZH-tw' }).defaultTargetLanguage.tag).toBe('zh-TW');
  });

  it('rejects a malformed language tag at startup', () => {
    expect(() => readConfig({ ...REQUIRED, DEFAULT_TARGET_LANGUAGE: 'ja_JP' })).toThrow(/^DEFAULT_TARGET_LANGUAGE: /);
  });

  it('rejects a log level other than those listed in .env.example', () => {
    expect(() => readConfig({ ...REQUIRED, LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });
});
