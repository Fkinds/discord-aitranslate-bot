import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly method: string;
  /** The path and query, such as "/v1beta/models/m:generateContent". */
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

export interface StubResponse {
  readonly status: number;
  /** Sent as JSON. */
  readonly body: unknown;
  /** How long to hold the response back. */
  readonly delayMs?: number;
}

/**
 * An HTTP server on 127.0.0.1 for medium tests: it answers each request with
 * the next response it was given, and records the requests. With no response
 * left, it answers 500, so that a test sees the extra request fail.
 */
export class HttpStub {
  readonly requests: RecordedRequest[] = [];
  private readonly responses: StubResponse[] = [];

  private constructor(private readonly server: http.Server) {}

  static async start(): Promise<HttpStub> {
    const stub: HttpStub = new HttpStub(http.createServer((req, res) => stub.answer(req, res)));
    await new Promise<void>((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
    return stub;
  }

  /** Where the server listens, such as "http://127.0.0.1:50123", without a trailing slash. */
  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  respond(...responses: StubResponse[]): void {
    this.responses.push(...responses);
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => this.server.close((error) => (error ? reject(error) : resolve())));
  }

  private answer(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      this.requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const response = this.responses.shift() ?? { status: 500, body: { error: 'HttpStub has no response left' } };
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response.body));
      };
      if (response.delayMs) setTimeout(send, response.delayMs).unref();
      else send();
    });
  }
}
