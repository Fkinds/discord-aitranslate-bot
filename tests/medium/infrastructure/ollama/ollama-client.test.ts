import { describe, it, expect, afterEach, beforeEach } from '@jest/globals';
import { OllamaClient, OllamaRequestFailed } from '../../../../src/infrastructure/ollama/ollama-client';
import { HttpStub, type StubResponse } from '../../../support/http-stub';

/** What Ollama answers to a chat, without streaming (https://docs.ollama.com/api/chat). */
const answer = (content: string): StubResponse => ({
  status: 200,
  body: {
    model: 'translategemma:12b',
    created_at: '2026-11-26T12:00:00Z',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
  },
});
const failure = (status: number, error: string): StubResponse => ({ status, body: { error } });
const OPTIONS = { timeoutMs: 200, retryDelayMs: 10 };

// The client against a stand-in for Ollama on localhost.
describe('OllamaClient.chat', () => {
  let ollama: HttpStub;
  let client: OllamaClient;

  beforeEach(async () => {
    ollama = await HttpStub.start();
    client = new OllamaClient(new URL(ollama.url), OPTIONS);
  });

  afterEach(async () => {
    await ollama.stop();
  });

  it("sends one message to the chat API, keeping the model loaded, and reads the model's answer", async () => {
    ollama.respond(answer('내일 몇 시에 모이기로 했지?'));

    expect(await client.chat('translategemma:12b', '明日って何時集合だっけ')).toBe('내일 몇 시에 모이기로 했지?');
    const [request] = ollama.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/api/chat');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request!.body)).toEqual({
      model: 'translategemma:12b',
      messages: [{ role: 'user', content: '明日って何時集合だっけ' }],
      stream: false,
      keep_alive: -1,
      options: { temperature: 0 },
    });
  });

  it('calls the API under the path of OLLAMA_HOST, as behind a proxy', async () => {
    ollama.respond(answer('OK'));

    await new OllamaClient(new URL(`${ollama.url}/ollama`), OPTIONS).chat('m', 'hi');

    expect(ollama.requests[0]?.url).toBe('/ollama/api/chat');
  });

  it('tries again once after a connection that went away', async () => {
    ollama.respond({ status: 200, body: {}, hangUp: true }, answer('OK'));

    expect(await client.chat('m', 'hi')).toBe('OK');
    expect(ollama.requests).toHaveLength(2);
  });

  it('tries again once after Ollama failed', async () => {
    ollama.respond(failure(503, 'server busy'), answer('OK'));

    expect(await client.chat('m', 'hi')).toBe('OK');
    expect(ollama.requests).toHaveLength(2);
  });

  it('gives up when Ollama fails again, saying why', async () => {
    ollama.respond(failure(500, 'llama runner process has terminated'), failure(500, 'llama runner process has terminated'));

    const error = await client.chat('m', 'hi').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OllamaRequestFailed);
    expect(error).toMatchObject({
      message: 'Ollama answered HTTP 500: llama runner process has terminated',
      failure: 'refused',
      status: 500,
    });
    expect(ollama.requests).toHaveLength(2);
  });

  it('gives up at once when Ollama refuses the request', async () => {
    ollama.respond(failure(404, "model 'translategemma:12b' not found"));

    await expect(client.chat('translategemma:12b', 'hi')).rejects.toMatchObject({
      message: "Ollama answered HTTP 404: model 'translategemma:12b' not found",
      failure: 'refused',
      status: 404,
    });
    expect(ollama.requests).toHaveLength(1);
  });

  it('gives up at once on a request that takes too long, without trying again', async () => {
    ollama.respond({ ...answer('OK'), delayMs: 1_000 });

    await expect(client.chat('m', 'hi')).rejects.toMatchObject({
      message: 'Ollama did not answer within 200 ms',
      failure: 'timeout',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ollama.requests).toHaveLength(1);
  });

  it.each([
    ['other than JSON', { status: 200, body: new TextEncoder().encode('not JSON') }, 'Ollama answered with something other than JSON'],
    ['without a message', { status: 200, body: { done: true } }, 'Ollama answered the chat without a message'],
  ])('fails when Ollama answers with something %s', async (_, response, message) => {
    ollama.respond(response);

    await expect(client.chat('m', 'hi')).rejects.toMatchObject({ message, failure: 'unreadable' });
    expect(ollama.requests).toHaveLength(1);
  });
});

describe('OllamaClient.chat, with Ollama not running', () => {
  it('tries again once, then fails, saying where it tried', async () => {
    const ollama = await HttpStub.start();
    const url = new URL(ollama.url);
    await ollama.stop();

    await expect(new OllamaClient(url, OPTIONS).chat('m', 'hi')).rejects.toMatchObject({
      message: `Could not connect to Ollama at ${url.href}`,
      failure: 'unreachable',
    });
  });
});
