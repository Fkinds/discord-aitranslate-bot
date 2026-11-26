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

/** A step of a download that Ollama reports, such as "pulling manifest", with the bytes of a layer when it has them. */
export interface PullProgress {
  readonly status: string;
  readonly total?: number;
  readonly completed?: number;
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

  /**
   * Whether Ollama has the model, by asking for what it knows of it.
   * @throws OllamaRequestFailed when Ollama cannot be asked.
   */
  async hasModel(model: string): Promise<boolean> {
    try {
      await this.post('api/show', { model });
      return true;
    } catch (error) {
      if (error instanceof OllamaRequestFailed && error.status === 404) return false;
      throw error;
    }
  }

  /**
   * Load the model into memory and keep it there, as chat does, so that the
   * first translation does not wait for it. Loading takes longer than a chat,
   * so this waits up to `timeoutMs`.
   *
   * @throws OllamaRequestFailed
   */
  async load(model: string, timeoutMs: number): Promise<void> {
    await this.post('api/generate', { model, keep_alive: -1 }, timeoutMs);
  }

  /**
   * Download the model, or find that it is all there already, telling
   * `onProgress` of each step Ollama reports. A download stopped part way
   * goes on from there the next time. It is not given up on after a time,
   * since it may be gigabytes, nor tried again.
   *
   * @throws OllamaRequestFailed when it could not be downloaded.
   */
  async pull(model: string, onProgress: (progress: PullProgress) => void): Promise<void> {
    let response: Response;
    try {
      response = await fetch(new URL('api/pull', this.base), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
      });
    } catch (error) {
      throw new OllamaRequestFailed(`Could not connect to Ollama at ${this.base.href}`, 'unreachable', undefined, { cause: error });
    }
    if (!response.ok) {
      throw new OllamaRequestFailed(`Ollama answered HTTP ${response.status}${reasonIn(await response.text())}`, 'refused', response.status);
    }

    let succeeded = false;
    try {
      for await (const line of linesOf(response.body)) {
        if (line.trim() === '') continue;
        const progress = progressIn(line, model);
        onProgress(progress);
        if (progress.status === 'success') succeeded = true;
      }
    } catch (error) {
      if (error instanceof OllamaRequestFailed) throw error;
      throw new OllamaRequestFailed(`Lost the connection to Ollama while pulling ${model}`, 'unreachable', undefined, {
        cause: error,
      });
    }
    if (!succeeded) throw new OllamaRequestFailed(`Ollama stopped pulling ${model} before it succeeded`, 'unreadable');
  }

  /** POST the body as JSON, and read the answer as JSON, trying again once when that may help. */
  private async post(path: string, body: unknown, timeoutMs = this.options.timeoutMs): Promise<unknown> {
    try {
      return await this.postOnce(path, body, timeoutMs);
    } catch (error) {
      if (!mayPass(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs));
      return this.postOnce(path, body, timeoutMs);
    }
  }

  private async postOnce(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    const url = new URL(path, this.base);
    const signal = AbortSignal.timeout(timeoutMs);
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
        throw new OllamaRequestFailed(`Ollama did not answer within ${timeoutMs} ms`, 'timeout', undefined, {
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

/** The lines of a stream of text, without their line breaks. */
async function* linesOf(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (body === null) return;
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of body) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
    rest = lines.pop() ?? '';
    yield* lines;
  }
  rest += decoder.decode();
  if (rest !== '') yield rest;
}

/** A step of a pull, from a line of Ollama's answer. @throws OllamaRequestFailed when the line is an error, or not a step. */
function progressIn(line: string, model: string): PullProgress {
  let progress: { status?: unknown; total?: unknown; completed?: unknown; error?: unknown } | null;
  try {
    progress = JSON.parse(line) as typeof progress;
  } catch (error) {
    throw new OllamaRequestFailed(`Ollama answered the pull of ${model} with something other than JSON`, 'unreadable', undefined, {
      cause: error,
    });
  }
  if (typeof progress?.error === 'string') {
    throw new OllamaRequestFailed(`Ollama could not pull ${model}: ${progress.error}`, 'refused');
  }
  if (typeof progress?.status !== 'string') {
    throw new OllamaRequestFailed(`Ollama answered the pull of ${model} without a status`, 'unreadable');
  }
  return {
    status: progress.status,
    ...(typeof progress.total === 'number' ? { total: progress.total } : {}),
    ...(typeof progress.completed === 'number' ? { completed: progress.completed } : {}),
  };
}
