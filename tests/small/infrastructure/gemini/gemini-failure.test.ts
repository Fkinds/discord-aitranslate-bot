import { describe, it, expect } from '@jest/globals';
import { ApiError } from '@google/genai';
import { classifyFailure } from '../../../../src/infrastructure/gemini/gemini-failure';
import { AnswerBlocked } from '../../../../src/infrastructure/gemini/gemini-translator';

/** An ApiError as @google/genai makes it: the status, and the JSON error body as the message. */
const apiError = (status: number, details: unknown[] = []) =>
  new ApiError({ status, message: JSON.stringify({ error: { code: status, message: 'm', status: 'S', details } }) });
const retryInfo = (retryDelay: string) => ({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay });

describe('classifyFailure', () => {
  it.each([408, 429, 500, 502, 503, 504])('takes HTTP %i as transient', (status) => {
    expect(classifyFailure(apiError(status))).toEqual({ kind: 'transient' });
  });

  it.each([400, 401, 403, 404, 501])('takes HTTP %i as permanent', (status) => {
    expect(classifyFailure(apiError(status))).toEqual({ kind: 'permanent' });
  });

  it.each([
    ['20s', 20_000],
    ['1.5s', 1500],
    ['0.000000001s', 1],
    ['0s', 0],
  ])('reads the wait a 429 asks for, %s', (retryDelay, advisedDelayMs) => {
    const quota = { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [] };

    expect(classifyFailure(apiError(429, [quota, retryInfo(retryDelay)]))).toEqual({ kind: 'transient', advisedDelayMs });
  });

  it.each(['20', '20 seconds', '-1s', '1.5ms'])('ignores a wait it cannot read, %s', (retryDelay) => {
    expect(classifyFailure(apiError(429, [retryInfo(retryDelay)]))).toEqual({ kind: 'transient' });
  });

  it('ignores a wait in an error that is not a 429', () => {
    expect(classifyFailure(apiError(503, [retryInfo('20s')]))).toEqual({ kind: 'transient' });
  });

  it('takes a 429 whose message is not JSON as transient', () => {
    expect(classifyFailure(new ApiError({ status: 429, message: 'Too Many Requests' }))).toEqual({ kind: 'transient' });
  });

  it('takes a failed connection as transient, even when wrapped', () => {
    const fetchFailed = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') });

    expect(classifyFailure(fetchFailed)).toEqual({ kind: 'transient' });
    expect(classifyFailure(new Error('exception TypeError: fetch failed sending request', { cause: fetchFailed }))).toEqual({
      kind: 'transient',
    });
  });

  it('takes a timeout as transient', () => {
    expect(classifyFailure(new DOMException('This operation was aborted', 'AbortError'))).toEqual({ kind: 'transient' });
  });

  it.each([
    ['a blocked answer', new AnswerBlocked('Candidate was blocked due to SAFETY')],
    ['any other error', new Error('Unexpected token < in JSON')],
    ['a TypeError of another kind', new TypeError('Failed to parse URL')],
    ['something thrown that is not an error', 'boom'],
  ])('takes %s as permanent', (_, error) => {
    expect(classifyFailure(error)).toEqual({ kind: 'permanent' });
  });
});
