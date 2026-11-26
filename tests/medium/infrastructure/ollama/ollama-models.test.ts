import { describe, it, expect, afterEach, beforeEach } from '@jest/globals';
import { OllamaClient, type PullProgress } from '../../../../src/infrastructure/ollama/ollama-client';
import { HttpStub, type StubResponse } from '../../../support/http-stub';

const MODEL = 'translategemma:12b';
const OPTIONS = { timeoutMs: 200, retryDelayMs: 10 };
const failure = (status: number, error: string): StubResponse => ({ status, body: { error } });
/** What Ollama streams for a pull: one JSON object a line (https://docs.ollama.com/api/pull). */
const streamed = (...lines: unknown[]): StubResponse => ({
  status: 200,
  body: new TextEncoder().encode(lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n'),
});

// The calls for the model itself, against a stand-in for Ollama on localhost.
describe('OllamaClient, for the model', () => {
  let ollama: HttpStub;
  let client: OllamaClient;

  beforeEach(async () => {
    ollama = await HttpStub.start();
    client = new OllamaClient(new URL(ollama.url), OPTIONS);
  });

  afterEach(async () => {
    await ollama.stop();
  });

  describe('hasModel', () => {
    it('asks for what Ollama knows of the model, and finds it there', async () => {
      ollama.respond({ status: 200, body: { details: { family: 'gemma3' } } });

      expect(await client.hasModel(MODEL)).toBe(true);
      expect(ollama.requests.map(({ method, url, body }) => [method, url, JSON.parse(body)])).toEqual([
        ['POST', '/api/show', { model: MODEL }],
      ]);
    });

    it('finds the model missing when Ollama does not know it', async () => {
      ollama.respond(failure(404, `model '${MODEL}' not found`));

      expect(await client.hasModel(MODEL)).toBe(false);
    });

    it('fails when Ollama cannot be asked, after trying again once', async () => {
      ollama.respond(failure(500, 'internal error'), failure(500, 'internal error'));

      await expect(client.hasModel(MODEL)).rejects.toMatchObject({ failure: 'refused', status: 500 });
      expect(ollama.requests).toHaveLength(2);
    });
  });

  describe('load', () => {
    it('loads the model with no prompt, to be kept loaded, waiting longer than for a chat', async () => {
      ollama.respond({ status: 200, body: { model: MODEL, response: '', done: true, done_reason: 'load' }, delayMs: 300 });

      await client.load(MODEL, 2_000);

      expect(ollama.requests.map(({ url, body }) => [url, JSON.parse(body)])).toEqual([
        ['/api/generate', { model: MODEL, keep_alive: -1 }],
      ]);
    });

    it('gives up after the time it was given', async () => {
      ollama.respond({ status: 200, body: { done: true }, delayMs: 1_000 });

      await expect(client.load(MODEL, 300)).rejects.toMatchObject({
        message: 'Ollama did not answer within 300 ms',
        failure: 'timeout',
      });
    });
  });

  describe('pull', () => {
    it("pulls the model, telling of each step Ollama reports, with a layer's bytes", async () => {
      ollama.respond(
        streamed(
          { status: 'pulling manifest' },
          { status: 'pulling 3a8f', digest: 'sha256:3a8f', total: 8_100_000_000 },
          { status: 'pulling 3a8f', digest: 'sha256:3a8f', total: 8_100_000_000, completed: 4_050_000_000 },
          { status: 'verifying sha256 digest' },
          { status: 'writing manifest' },
          { status: 'success' }
        )
      );
      const progress: PullProgress[] = [];

      await client.pull(MODEL, (step) => progress.push(step));

      expect(ollama.requests.map(({ url, body }) => [url, JSON.parse(body)])).toEqual([
        ['/api/pull', { model: MODEL, stream: true }],
      ]);
      expect(progress).toEqual([
        { status: 'pulling manifest' },
        { status: 'pulling 3a8f', total: 8_100_000_000 },
        { status: 'pulling 3a8f', total: 8_100_000_000, completed: 4_050_000_000 },
        { status: 'verifying sha256 digest' },
        { status: 'writing manifest' },
        { status: 'success' },
      ]);
    });

    it('fails with the error Ollama streams, as for a model that does not exist', async () => {
      ollama.respond(streamed({ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }));

      await expect(client.pull('translategemma:99b', () => {})).rejects.toMatchObject({
        message: 'Ollama could not pull translategemma:99b: pull model manifest: file does not exist',
        failure: 'refused',
      });
    });

    it('fails when the stream ends before it succeeded', async () => {
      ollama.respond(streamed({ status: 'pulling manifest' }));

      await expect(client.pull(MODEL, () => {})).rejects.toThrow(`Ollama stopped pulling ${MODEL} before it succeeded`);
    });

    it.each([
      ['other than JSON', streamed('not JSON'), `Ollama answered the pull of ${MODEL} with something other than JSON`],
      ['without a status', streamed({ digest: 'sha256:3a8f' }), `Ollama answered the pull of ${MODEL} without a status`],
    ])('fails when Ollama answers %s', async (_, response, message) => {
      ollama.respond(response);

      await expect(client.pull(MODEL, () => {})).rejects.toMatchObject({ message, failure: 'unreadable' });
    });

    it('fails at once when Ollama refuses the pull, without trying again', async () => {
      ollama.respond(failure(500, 'no space left on device'));

      await expect(client.pull(MODEL, () => {})).rejects.toMatchObject({
        message: 'Ollama answered HTTP 500: no space left on device',
        failure: 'refused',
      });
      expect(ollama.requests).toHaveLength(1);
    });

    it('fails when Ollama is not running', async () => {
      const url = new URL(ollama.url);
      await ollama.stop();
      ollama = await HttpStub.start();

      await expect(new OllamaClient(url, OPTIONS).pull(MODEL, () => {})).rejects.toMatchObject({
        message: `Could not connect to Ollama at ${url.href}`,
        failure: 'unreachable',
      });
    });
  });
});
