import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LanguageCode } from '../../../../src/domain/language-code';
import {
  ClaudeTextTranslator,
  CREDENTIALS_HINT,
  requestFor,
} from '../../../../src/infrastructure/claude/claude-text-translator';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { HttpStub, type StubResponse } from '../../../support/http-stub';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const EN = LanguageCode.of('en');
const TEXT = '私たちは岩田さんの車でいきました。';

/** A Messages API answer whose text is `text`. */
const answer = (text: string): StubResponse => ({
  status: 200,
  body: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 120, output_tokens: 30 },
  },
});
const failure = (status: number, type: string): StubResponse => ({
  status,
  body: { type: 'error', error: { type, message: type } },
});
/**
 * How long a request may take: long enough for the Anthropic SDK's first
 * request on a busy CI runner, which took over 200 ms. The tests of a
 * timeout make a translator of their own, with 200 ms.
 */
const TIMEOUT_MS = 2_000;
const QUICK_TIMEOUT_MS = 200;
const REPLY = answer('{"ko": "우리는 이와타 씨의 차를 타고 갔습니다.", "en": "We went in Mr. Iwata\'s car."}');

// The Anthropic SDK and the translator against a stand-in for the Messages API on localhost.
describe('ClaudeTextTranslator over HTTP', () => {
  let api: HttpStub;
  let logger: FakeLogger;
  let translator: ClaudeTextTranslator;

  beforeEach(async () => {
    api = await HttpStub.start();
    logger = new FakeLogger();
    translator = new ClaudeTextTranslator('test-key', { timeoutMs: TIMEOUT_MS, maxRetries: 2, baseUrl: api.url }, logger);
  });

  afterEach(async () => {
    await api.stop();
  });

  it('sends the request with the API key to the Messages API, and reads the translations', async () => {
    api.respond(REPLY);

    const translations = await translator.translate(TEXT, JA, [KO, EN]);

    expect(translations).toEqual([
      { language: KO, text: '우리는 이와타 씨의 차를 타고 갔습니다.' },
      { language: EN, text: "We went in Mr. Iwata's car." },
    ]);
    const [request] = api.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/v1/messages');
    expect(request?.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(request!.body)).toEqual(JSON.parse(JSON.stringify(requestFor(TEXT, [KO, EN]))));
    expect(logger.entries).toContainEqual({
      level: 'debug',
      message: 'Translated with Claude',
      meta: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it('sends nothing when there is no language to translate into', async () => {
    expect(await translator.translate(TEXT, JA, [])).toEqual([]);
    expect(api.requests).toEqual([]);
  });

  it('tries again after a server error', async () => {
    api.respond(failure(529, 'overloaded_error'), REPLY);

    await expect(translator.translate(TEXT, JA, [KO, EN])).resolves.toHaveLength(2);
    expect(api.requests).toHaveLength(2);
  });

  it('abandons a request that takes too long, and tries again', async () => {
    api.respond({ ...REPLY, delayMs: 1_000 }, REPLY);
    const quick = new ClaudeTextTranslator('test-key', { timeoutMs: QUICK_TIMEOUT_MS, maxRetries: 2, baseUrl: api.url }, logger);

    await expect(quick.translate(TEXT, JA, [KO, EN])).resolves.toHaveLength(2);
    expect(api.requests).toHaveLength(2);
  });

  it('gives up after 3 attempts', async () => {
    api.respond(failure(500, 'api_error'), failure(500, 'api_error'), failure(500, 'api_error'));

    await expect(translator.translate(TEXT, JA, [KO])).rejects.toThrow('Translating with Claude failed: HTTP 500 (api_error)');
    expect(api.requests).toHaveLength(3);
  });

  it('gives up at once on HTTP 400', async () => {
    api.respond(failure(400, 'invalid_request_error'));

    const error = await translator.translate(TEXT, JA, [KO]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TranslationFailed);
    expect((error as Error).message).toBe('Translating with Claude failed: HTTP 400 (invalid_request_error)');
    expect(api.requests).toHaveLength(1);
  });

  it('gives up at once on HTTP 401, saying what to do', async () => {
    api.respond(failure(401, 'authentication_error'));

    await expect(translator.translate(TEXT, JA, [KO])).rejects.toThrow(
      `Translating with Claude failed: HTTP 401 (authentication_error): ${CREDENTIALS_HINT}`
    );
    expect(api.requests).toHaveLength(1);
  });
});

describe('ClaudeTextTranslator.checkAccess over HTTP', () => {
  let api: HttpStub;
  let translator: ClaudeTextTranslator;

  beforeEach(async () => {
    api = await HttpStub.start();
    translator = new ClaudeTextTranslator('test-key', { timeoutMs: TIMEOUT_MS, maxRetries: 2, baseUrl: api.url }, new FakeLogger());
  });

  afterEach(async () => {
    await api.stop();
  });

  it('asks once for the model the translations use, and finds access granted', async () => {
    api.respond({ status: 200, body: { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' } });

    expect(await translator.checkAccess()).toEqual({ kind: 'granted' });
    expect(api.requests.map((request) => [request.method, request.url, request.headers.authorization])).toEqual([
      ['GET', '/v1/models/claude-haiku-5-5', 'Bearer test-key'],
    ]);
  });

  it.each([
    [401, 'authentication_error', `HTTP 401 (authentication_error): ${CREDENTIALS_HINT}`],
    [403, 'permission_error', 'HTTP 403 (permission_error)'],
    [404, 'not_found_error', 'HTTP 404 (not_found_error)'],
  ])('finds access refused on HTTP %i', async (status, type, reason) => {
    api.respond(failure(status, type));

    expect(await translator.checkAccess()).toEqual({ kind: 'refused', reason });
    expect(api.requests).toHaveLength(1);
  });

  it('finds Claude unreachable on a server error, without asking again', async () => {
    api.respond(failure(500, 'api_error'), REPLY);

    expect(await translator.checkAccess()).toEqual({ kind: 'unreachable', reason: 'HTTP 500 (api_error)' });
    expect(api.requests).toHaveLength(1);
  });

  it('finds Claude unreachable when the answer takes too long, without asking again', async () => {
    api.respond({ ...REPLY, delayMs: 1_000 }, REPLY);
    const quick = new ClaudeTextTranslator(
      'test-key',
      { timeoutMs: QUICK_TIMEOUT_MS, maxRetries: 2, baseUrl: api.url },
      new FakeLogger()
    );

    expect(await quick.checkAccess()).toEqual({ kind: 'unreachable', reason: 'the request timed out' });
    expect(api.requests).toHaveLength(1);
  });
});

// The variables through which the SDK finds credentials of its own; each test sets the ones it needs.
const SDK_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_SERVICE_ACCOUNT_ID',
  'ANTHROPIC_WORKSPACE_ID',
  'ANTHROPIC_IDENTITY_TOKEN',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'ANTHROPIC_SCOPE',
];

// Without an API key, against a config directory of the test's own, never the one in the home directory.
describe('ClaudeTextTranslator without an API key', () => {
  const saved = Object.fromEntries(SDK_VARIABLES.map((name) => [name, process.env[name]]));
  let configDir: string;
  let api: HttpStub;

  /** The translator, made after the test has set up the credentials: the SDK looks for them once, as it is made. */
  const aTranslator = () =>
    new ClaudeTextTranslator(undefined, { timeoutMs: TIMEOUT_MS, maxRetries: 2, baseUrl: api.url }, new FakeLogger());

  /** What `ant auth login` leaves: a profile, and its token in a file only its owner may read. */
  async function signIn(token: string, workspaceId: string): Promise<void> {
    await mkdir(path.join(configDir, 'configs'));
    await mkdir(path.join(configDir, 'credentials'));
    await writeFile(
      path.join(configDir, 'configs', 'default.json'),
      JSON.stringify({ version: '1.0', authentication: { type: 'user_oauth' }, workspace_id: workspaceId })
    );
    await writeFile(
      path.join(configDir, 'credentials', 'default.json'),
      JSON.stringify({ version: '1.0', type: 'oauth_token', access_token: token }),
      { mode: 0o600 }
    );
  }

  beforeEach(async () => {
    for (const name of SDK_VARIABLES) delete process.env[name];
    configDir = await mkdtemp(path.join(tmpdir(), 'anthropic-config-'));
    process.env.ANTHROPIC_CONFIG_DIR = configDir;
    api = await HttpStub.start();
  });

  afterEach(async () => {
    await api.stop();
    await rm(configDir, { recursive: true, force: true });
    for (const name of SDK_VARIABLES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('sends the token ant auth login keeps, and never ANTHROPIC_API_KEY', async () => {
    await signIn('signed-in-token', 'wrkspc_test');
    process.env.ANTHROPIC_API_KEY = 'key-in-the-environment';
    api.respond(REPLY);
    const translator = aTranslator();

    expect(await translator.credentials()).toEqual({ kind: 'sign-in', workspaceId: 'wrkspc_test' });
    await expect(translator.translate(TEXT, JA, [KO, EN])).resolves.toHaveLength(2);
    expect(api.requests[0]?.headers.authorization).toBe('Bearer signed-in-token');
  });

  it('tells Workload Identity Federation by its variables, without exchanging a token', async () => {
    process.env.ANTHROPIC_FEDERATION_RULE_ID = 'fdrl_test';
    process.env.ANTHROPIC_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';
    process.env.ANTHROPIC_IDENTITY_TOKEN = 'identity-token';
    const translator = aTranslator();

    expect(await translator.credentials()).toEqual({ kind: 'federation', federationRuleId: 'fdrl_test', workspaceId: null });
    expect(api.requests).toEqual([]);
  });

  it('finds no credentials, and access refused without sending anything', async () => {
    const translator = aTranslator();

    expect(await translator.credentials()).toEqual({ kind: 'none' });
    expect(await translator.checkAccess()).toEqual({
      kind: 'refused',
      reason: expect.stringContaining('Could not resolve authentication method'),
    });
    expect(api.requests).toEqual([]);
  });

  it('fails on a profile ANTHROPIC_PROFILE names that does not exist', async () => {
    process.env.ANTHROPIC_PROFILE = 'missing';

    await expect(aTranslator().credentials()).rejects.toThrow('ANTHROPIC_PROFILE names the profile "missing"');
  });
});
