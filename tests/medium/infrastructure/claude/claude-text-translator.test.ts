import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { ClaudeTextTranslator, requestFor } from '../../../../src/infrastructure/claude/claude-text-translator';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { HttpStub, type StubResponse } from '../../../support/http-stub';

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
const REPLY = answer('{"ko": "우리는 이와타 씨의 차를 타고 갔습니다.", "en": "We went in Mr. Iwata\'s car."}');

// The Anthropic SDK and the translator against a stand-in for the Messages API on localhost.
describe('ClaudeTextTranslator over HTTP', () => {
  let api: HttpStub;
  let logger: FakeLogger;
  let translator: ClaudeTextTranslator;

  beforeEach(async () => {
    api = await HttpStub.start();
    logger = new FakeLogger();
    translator = new ClaudeTextTranslator('test-key', { timeoutMs: 200, maxRetries: 2, baseUrl: api.url }, logger);
  });

  afterEach(async () => {
    await api.stop();
  });

  it('sends the request with the API key to the Messages API, and reads the translations', async () => {
    api.respond(REPLY);

    const translations = await translator.translate(TEXT, [KO, EN]);

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
    expect(await translator.translate(TEXT, [])).toEqual([]);
    expect(api.requests).toEqual([]);
  });

  it('tries again after a server error', async () => {
    api.respond(failure(529, 'overloaded_error'), REPLY);

    await expect(translator.translate(TEXT, [KO, EN])).resolves.toHaveLength(2);
    expect(api.requests).toHaveLength(2);
  });

  it('abandons a request that takes too long, and tries again', async () => {
    api.respond({ ...REPLY, delayMs: 1_000 }, REPLY);

    await expect(translator.translate(TEXT, [KO, EN])).resolves.toHaveLength(2);
    expect(api.requests).toHaveLength(2);
  });

  it('gives up after 3 attempts', async () => {
    api.respond(failure(500, 'api_error'), failure(500, 'api_error'), failure(500, 'api_error'));

    await expect(translator.translate(TEXT, [KO])).rejects.toThrow('Translating with Claude failed: HTTP 500 (api_error)');
    expect(api.requests).toHaveLength(3);
  });

  it.each([
    [400, 'invalid_request_error'],
    [401, 'authentication_error'],
  ])('gives up at once on HTTP %i', async (status, type) => {
    api.respond(failure(status, type));

    const error = await translator.translate(TEXT, [KO]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TranslationFailed);
    expect((error as Error).message).toBe(`Translating with Claude failed: HTTP ${status} (${type})`);
    expect(api.requests).toHaveLength(1);
  });
});
