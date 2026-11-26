/**
 * How a request to Ollama failed:
 * - `unreachable`: it could not be sent, as when Ollama is not running.
 * - `timeout`: Ollama did not answer in time.
 * - `refused`: Ollama answered with an error, such as HTTP 404 for a model it does not have.
 * - `unreadable`: Ollama answered with something other than what was asked for.
 */
export type OllamaFailure = 'unreachable' | 'timeout' | 'refused' | 'unreadable';

/** A request to Ollama failed; `failure` says how, and the message why. */
export class OllamaRequestFailed extends Error {
  constructor(
    message: string,
    readonly failure: OllamaFailure,
    readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface OllamaOptions {
  /** Give up on a request after this long. */
  readonly timeoutMs: number;
  /** How long to wait before trying a request again once, after it could not be sent or Ollama failed (5xx). */
  readonly retryDelayMs: number;
}

/**
 * Calls Ollama's HTTP API (https://docs.ollama.com/api). A request that could
 * not be sent, or that Ollama failed (HTTP 5xx), is tried again once; one that
 * timed out is not, so as not to keep the utterances after it waiting.
 */
export class OllamaClient {
  private readonly base: URL;

  /** @param url where Ollama is, from ollamaUrlFrom. */
  constructor(
    url: URL,
    private readonly options: OllamaOptions
  ) {
    this.base = new URL(url.href.endsWith('/') ? url.href : `${url.href}/`);
  }

  /** Where Ollama is, for the log. */
  get url(): string {
    return this.base.href;
  }

  /**
   * What the model answers to one message from the user, with temperature 0,
   * so that the same message gets the same answer. The model is kept loaded
   * after it, rather than for Ollama's default of 5 minutes.
   *
   * @throws OllamaRequestFailed
   */
  async chat(model: string, message: string): Promise<string> {
    const answer = await this.post('api/chat', {
      model,
      messages: [{ role: 'user', content: message }],
      stream: false,
      keep_alive: -1,
      options: { temperature: 0 },
    });
    const content = (answer as { message?: { content?: unknown } } | null)?.message?.content;
    if (typeof content !== 'string') {
      throw new OllamaRequestFailed('Ollama answered the chat without a message', 'unreadable');
    }
    return content;
  }

  /** POST the body as JSON, and read the answer as JSON, trying again once when that may help. */
  private async post(path: string, body: unknown): Promise<unknown> {
    try {
      return await this.postOnce(path, body);
    } catch (error) {
      if (!mayPass(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs));
      return this.postOnce(path, body);
    }
  }

  private async postOnce(path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, this.base);
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new OllamaRequestFailed(`Ollama answered HTTP ${response.status}${reasonIn(text)}`, 'refused', response.status);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new OllamaRequestFailed('Ollama answered with something other than JSON', 'unreadable', response.status, {
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof OllamaRequestFailed) throw error;
      if (signal.aborted) {
        throw new OllamaRequestFailed(`Ollama did not answer within ${this.options.timeoutMs} ms`, 'timeout', undefined, {
          cause: error,
        });
      }
      throw new OllamaRequestFailed(`Could not connect to Ollama at ${this.base.href}`, 'unreachable', undefined, {
        cause: error,
      });
    }
  }
}

/** Whether trying the request again may help: it could not be sent, or Ollama failed (5xx). */
function mayPass(error: unknown): boolean {
  if (!(error instanceof OllamaRequestFailed)) return false;
  return error.failure === 'unreachable' || (error.failure === 'refused' && (error.status ?? 0) >= 500);
}

/** The reason in Ollama's error answer, `{"error": "..."}`, as ": <reason>"; empty when there is none. */
function reasonIn(text: string): string {
  try {
    const error = (JSON.parse(text) as { error?: unknown } | null)?.error;
    return typeof error === 'string' && error !== '' ? `: ${error}` : '';
  } catch {
    return '';
  }
}
