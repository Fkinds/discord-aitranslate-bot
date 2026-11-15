import { describe, it, expect, afterAll, afterEach, beforeEach } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaudeTextTranslator, CREDENTIALS_HINT } from '../../src/infrastructure/claude/claude-text-translator';
import { OneAtATime } from '../../src/infrastructure/local/one-at-a-time';
import { requireClaude, translatorFor } from '../../src/main';
import { FakeLogger } from '../support/fakes/fake-logger';
import { HttpStub, type StubResponse } from '../support/http-stub';
import { LOCAL_MODEL_TIMEOUT_MS, localModelsDir } from '../support/local-models';

/** What the Models API answers for the model the translations use. */
const MODEL: StubResponse = { status: 200, body: { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' } };
const failure = (status: number, type: string): StubResponse => ({
  status,
  body: { type: 'error', error: { type, message: type } },
});

// The startup check, against a stand-in for the Anthropic API on localhost.
describe('requireClaude', () => {
  let api: HttpStub;
  let logger: FakeLogger;
  const claude = (apiKey: string | undefined) =>
    new ClaudeTextTranslator(apiKey, { timeoutMs: 200, maxRetries: 2, baseUrl: api.url }, logger);

  beforeEach(async () => {
    api = await HttpStub.start();
    logger = new FakeLogger();
  });

  afterEach(async () => {
    await api.stop();
  });

  it('logs which credentials Claude is called with, never the key, and that Claude can be called', async () => {
    api.respond(MODEL);

    await requireClaude(claude('secret-key'), logger);

    expect(logger.entries).toEqual([
      { level: 'info', message: 'Calling Claude', meta: { credentials: 'api-key' } },
      { level: 'info', message: 'Claude can be called' },
    ]);
  });

  it('stops the bot when Claude refuses the credentials, saying what to do', async () => {
    api.respond(failure(401, 'authentication_error'));

    await expect(requireClaude(claude('wrong-key'), logger)).rejects.toThrow(
      `Claude cannot be called: HTTP 401 (authentication_error): ${CREDENTIALS_HINT}`
    );
  });

  it('warns, and goes on, when Claude cannot be asked now', async () => {
    api.respond(failure(503, 'overloaded_error'));

    await requireClaude(claude('key'), logger);

    expect(logger.entries).toContainEqual({
      level: 'warn',
      message: 'Could not check that Claude can be called; going on, and translations fail until it can be',
      meta: { reason: 'HTTP 503 (overloaded_error)' },
    });
  });

  describe('without an API key or a sign-in', () => {
    // The SDK finds a sign-in through these; a config directory of the test's own has none.
    const VARIABLES = ['ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID'];
    const saved = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));
    let configDir: string;

    beforeEach(async () => {
      for (const name of VARIABLES) delete process.env[name];
      configDir = await mkdtemp(path.join(tmpdir(), 'anthropic-config-'));
      process.env.ANTHROPIC_CONFIG_DIR = configDir;
    });

    afterEach(async () => {
      await rm(configDir, { recursive: true, force: true });
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('stops the bot before asking, saying how to sign in', async () => {
      await expect(requireClaude(claude(undefined), logger)).rejects.toThrow(
        'There are no credentials for Claude. Sign in with ant auth login, or set ANTHROPIC_API_KEY'
      );
      expect(api.requests).toEqual([]);
    });
  });
});

// Whisper with Claude, as main.ts builds it: the models from models/, the Anthropic API on localhost.
describe('translatorFor, with TRANSLATOR=claude', () => {
  const empty = mkdtemp(path.join(tmpdir(), 'models-'));
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL;
  let api: HttpStub;

  beforeEach(async () => {
    api = await HttpStub.start();
    process.env.ANTHROPIC_BASE_URL = api.url;
  });

  afterEach(async () => {
    await api.stop();
    if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
  });

  afterAll(async () => {
    await rm(await empty, { recursive: true, force: true });
  });

  it(
    'checks that Claude can be called, loads Whisper, and translates one utterance at a time',
    async () => {
      api.respond(MODEL);
      const logger = new FakeLogger();

      const translator = await translatorFor({ kind: 'claude', apiKey: 'key', modelsDir: localModelsDir() }, logger);

      expect(translator).toBeInstanceOf(OneAtATime);
      expect(logger.messages('info')).toEqual([
        'Calling Claude',
        'Claude can be called',
        'Loading the local models',
        'Loaded the local models',
      ]);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );

  it('stops the bot at startup when Claude cannot be called, before loading Whisper', async () => {
    api.respond(failure(404, 'not_found_error'));
    const logger = new FakeLogger();

    const loading = translatorFor({ kind: 'claude', apiKey: 'key', modelsDir: localModelsDir() }, logger);

    await expect(loading).rejects.toThrow('Claude cannot be called: HTTP 404 (not_found_error)');
    expect(logger.messages('info')).not.toContain('Loading the local models');
  });

  it('stops the bot at startup when the speech models are missing, without asking Claude', async () => {
    const modelsDir = await empty;

    const loading = translatorFor({ kind: 'claude', apiKey: 'key', modelsDir }, new FakeLogger());

    await expect(loading).rejects.toThrow(
      `The local models are missing from ${modelsDir}: silero-vad/silero_vad.onnx, whisper-large-v3-turbo/turbo-encoder.int8.onnx, ` +
        'whisper-large-v3-turbo/turbo-decoder.int8.onnx, whisper-large-v3-turbo/turbo-tokens.txt. ' +
        'Run pnpm models:download, or set MODELS_DIR to where they are'
    );
    expect(api.requests).toEqual([]);
  });
});
