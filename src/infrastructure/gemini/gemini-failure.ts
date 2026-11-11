import { ApiError } from '@google/genai';

/** Whether trying the same request again might succeed. */
export type GeminiFailure =
  | {
      readonly kind: 'transient';
      /** How long Gemini asked the caller to wait before trying again, if it said. */
      readonly advisedDelayMs?: number;
    }
  | { readonly kind: 'permanent' };

/**
 * Statuses that may pass on their own: 408 Request Timeout and the server
 * errors (RFC 9110), and 429 Too Many Requests (RFC 6585). Any other status
 * means the request itself is refused, and sending it again changes nothing.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const RETRY_INFO_TYPE = 'type.googleapis.com/google.rpc.RetryInfo';

/**
 * Sort a failure of a Gemini request: an HTTP error by its status, a timeout
 * or a failed connection as transient, anything else as permanent.
 */
export function classifyFailure(error: unknown): GeminiFailure {
  if (error instanceof ApiError) {
    if (!TRANSIENT_STATUSES.has(error.status)) return { kind: 'permanent' };
    const advisedDelayMs = error.status === 429 ? advisedDelay(error.message) : undefined;
    return advisedDelayMs === undefined ? { kind: 'transient' } : { kind: 'transient', advisedDelayMs };
  }
  const chain = causes(error);
  // A timeout aborts the request; a failed connection makes fetch() reject
  // with TypeError("fetch failed"). Names, not classes, since the error may
  // come from another realm.
  const timedOut = chain.some((e) => e.name === 'AbortError' || e.name === 'TimeoutError');
  const notConnected = chain.some((e) => e.name === 'TypeError' && e.message === 'fetch failed');
  return timedOut || notConnected ? { kind: 'transient' } : { kind: 'permanent' };
}

/**
 * The wait Gemini asks for in a 429: the retryDelay of the google.rpc.RetryInfo
 * in the error's details, a protobuf Duration in JSON such as "20s" or "1.5s".
 */
function advisedDelay(message: string): number | undefined {
  let body: unknown;
  try {
    body = JSON.parse(message);
  } catch {
    return undefined;
  }
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return undefined;
  const retryInfo = details.find((detail) => (detail as { '@type'?: unknown } | null)?.['@type'] === RETRY_INFO_TYPE);
  const retryDelay: unknown = (retryInfo as { retryDelay?: unknown } | undefined)?.retryDelay;
  const match = typeof retryDelay === 'string' ? /^(\d+)(?:\.(\d{1,9}))?s$/.exec(retryDelay) : null;
  if (!match) return undefined;
  const [, seconds, fraction = ''] = match;
  return Number(seconds) * 1000 + Math.ceil(Number(`0.${fraction || '0'}`) * 1000);
}

/** The error and the errors it was caused by, outermost first. */
function causes(error: unknown): Array<{ name: string; message: string }> {
  const chain: Array<{ name: string; message: string }> = [];
  for (let e: unknown = error; isErrorLike(e) && chain.length < 10; e = (e as { cause?: unknown }).cause) {
    chain.push(e);
  }
  return chain;
}

function isErrorLike(value: unknown): value is { name: string; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { name, message } = value as Record<string, unknown>;
  return typeof name === 'string' && typeof message === 'string';
}
