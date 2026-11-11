import { describe, it, expect, beforeEach } from '@jest/globals';
import { ApiError, type Part } from '@google/genai';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { answerSchemaFor, instructionsFor } from '../../../../src/infrastructure/gemini/gemini-answer';
import {
  AnswerBlocked,
  AnswerUnreadable,
  answerText,
  type GeminiModel,
  GeminiTranslator,
  geminiModel,
} from '../../../../src/infrastructure/gemini/gemini-translator';
import { toWav } from '../../../../src/infrastructure/gemini/wav';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';
import { FakeLogger } from '../../../support/fakes/fake-logger';

/** Answers each request with the next of the replies it was given; an Error is thrown. */
class FakeGeminiModel implements GeminiModel {
  readonly requests: Array<{ parts: Part[]; schema: Record<string, unknown> }> = [];

  constructor(private readonly replies: Array<string | Error>) {}

  async generateJson(parts: Part[], schema: Record<string, unknown>): Promise<string> {
    this.requests.push({ parts, schema });
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error('no reply left');
    if (reply instanceof Error) throw reply;
    return reply;
  }
}

const SPEECH = SpeechAudio.fromPcm(new Uint8Array([1, 2, 3, 4]));
const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const JA_KO = TranslationLanguages.of(JA, KO);
const REPLY = JSON.stringify({
  transcription: '안녕하세요',
  spokenLanguage: 'ko',
  translations: { ja: 'こんにちは', ko: '안녕하세요' },
  confidence: 0.9,
});
const unavailable = () => new ApiError({ status: 503, message: '{"error":{"code":503,"status":"UNAVAILABLE"}}' });
const tooManyRequests = (retryDelay: string) =>
  new ApiError({
    status: 429,
    message: JSON.stringify({
      error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] },
    }),
  });

describe('GeminiTranslator', () => {
  let logger: FakeLogger;
  let waits: number[];
  const noWait = async (ms: number) => {
    waits.push(ms);
  };

  const translatorFor = (model: GeminiModel, attempts = 3) =>
    new GeminiTranslator(model, { attempts, initialDelayMs: 1000, maxAdvisedDelayMs: 5000 }, logger, noWait);

  beforeEach(() => {
    logger = new FakeLogger();
    waits = [];
  });

  it('sends the instructions and the speech as a WAVE file, asks for the answer schema, and reads the answer', async () => {
    const model = new FakeGeminiModel([REPLY]);

    const translation = await translatorFor(model).translate(SPEECH, JA_KO);

    expect(model.requests).toEqual([
      {
        parts: [{ text: instructionsFor(JA_KO) }, { inlineData: { mimeType: 'audio/wav', data: toWav(SPEECH).toString('base64') } }],
        schema: answerSchemaFor(JA_KO),
      },
    ]);
    expect(translation.original).toBe('안녕하세요');
    expect(translation.spokenLanguage?.equals(KO)).toBe(true);
    expect(translation.translations.map(({ language, text }) => [language.tag, text])).toEqual([
      ['ja', 'こんにちは'],
      ['ko', '안녕하세요'],
    ]);
    expect(logger.messages('info')).toEqual(['Translation completed']);
  });

  it('gives up at once on an answer it cannot read, rather than post it', async () => {
    const model = new FakeGeminiModel(['こんにちは', REPLY]);

    const failure = await translatorFor(model)
      .translate(SPEECH, JA_KO)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TranslationFailed);
    expect((failure as TranslationFailed).cause).toBeInstanceOf(AnswerUnreadable);
    expect(model.requests).toHaveLength(1);
  });

  it('tries a transient failure again, waiting 1 s and then 2 s', async () => {
    const model = new FakeGeminiModel([unavailable(), new TypeError('fetch failed'), REPLY]);

    const translation = await translatorFor(model).translate(SPEECH, JA_KO);

    expect(translation.original).toBe('안녕하세요');
    expect(model.requests).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
    expect(logger.messages('warn')).toEqual(['Translation failed, retrying', 'Translation failed, retrying']);
  });

  it('fails with the last failure as the cause once every attempt has failed', async () => {
    const last = unavailable();
    const model = new FakeGeminiModel([unavailable(), unavailable(), last]);

    const failure = await translatorFor(model)
      .translate(SPEECH, JA_KO)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TranslationFailed);
    expect((failure as TranslationFailed).cause).toBe(last);
    expect(model.requests).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it.each([
    ['a refused request', new ApiError({ status: 400, message: '{"error":{"code":400}}' })],
    ['a blocked answer', new AnswerBlocked('Candidate was blocked due to SAFETY')],
  ])('gives up at once on %s, which trying again would not change', async (_, error) => {
    const model = new FakeGeminiModel([error, REPLY]);

    const failure = await translatorFor(model)
      .translate(SPEECH, JA_KO)
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TranslationFailed);
    expect((failure as TranslationFailed).cause).toBe(error);
    expect(model.requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('waits as long as Gemini asks, when that is at most 5 s', async () => {
    const model = new FakeGeminiModel([tooManyRequests('5s'), REPLY]);

    await expect(translatorFor(model).translate(SPEECH, JA_KO)).resolves.toMatchObject({ original: '안녕하세요' });
    expect(waits).toEqual([5000]);
  });

  it('gives up at once when Gemini asks to wait longer than 5 s', async () => {
    const model = new FakeGeminiModel([tooManyRequests('5.001s'), REPLY]);

    await expect(translatorFor(model).translate(SPEECH, JA_KO)).rejects.toThrow('asked to wait 5001 ms');
    expect(model.requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('tries once when the policy says one attempt', async () => {
    const model = new FakeGeminiModel([unavailable()]);

    await expect(translatorFor(model, 1).translate(SPEECH, JA_KO)).rejects.toThrow(TranslationFailed);
    expect(waits).toEqual([]);
  });

  it.each([
    [{ attempts: 0, initialDelayMs: 1000, maxAdvisedDelayMs: 5000 }],
    [{ attempts: 1.5, initialDelayMs: 1000, maxAdvisedDelayMs: 5000 }],
    [{ attempts: 3, initialDelayMs: -1, maxAdvisedDelayMs: 5000 }],
    [{ attempts: 3, initialDelayMs: Number.NaN, maxAdvisedDelayMs: 5000 }],
    [{ attempts: 3, initialDelayMs: 1000, maxAdvisedDelayMs: -1 }],
  ])('rejects the retry policy %j', (retry) => {
    expect(() => new GeminiTranslator(new FakeGeminiModel([]), retry, logger)).toThrow(RangeError);
  });
});

describe('geminiModel', () => {
  it('needs an API key', () => {
    expect(() => geminiModel('   ', 'gemini-3.8-flash', { timeoutMs: 15_000 })).toThrow('Gemini API key is required');
  });

  it.each([0, -1, 1.5])('needs a positive timeout, not %s', (timeoutMs) => {
    expect(() => geminiModel('test-key', 'gemini-3.8-flash', { timeoutMs })).toThrow(RangeError);
  });

  it('makes a model without connecting', () => {
    expect(typeof geminiModel('test-key', 'gemini-3.8-flash', { timeoutMs: 15_000 }).generateJson).toBe('function');
  });
});

describe('answerText', () => {
  const candidate = (parts: Part[], finishReason?: string) => ({ content: { role: 'model', parts }, finishReason });

  it("joins the first candidate's text parts, leaving out thoughts", () => {
    const answer = { candidates: [candidate([{ text: 'Hel' }, { text: 'thinking', thought: true }, { text: 'lo' }])] };

    expect(answerText(answer as never)).toBe('Hello');
  });

  it('is empty when there is no candidate and nothing was blocked, as the old SDK had it', () => {
    expect(answerText({ candidates: [] })).toBe('');
  });

  it.each(['SAFETY', 'RECITATION', 'LANGUAGE'])('fails when the candidate finished for %s', (finishReason) => {
    const answer = { candidates: [candidate([{ text: 'partial' }], finishReason)] };

    expect(() => answerText(answer as never)).toThrow(new AnswerBlocked(`Candidate was blocked due to ${finishReason}`));
  });

  it('reads a candidate that finished normally', () => {
    expect(answerText({ candidates: [candidate([{ text: 'Hello' }], 'STOP')] } as never)).toBe('Hello');
  });

  it('fails with the reason when the prompt was blocked', () => {
    const answer = { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'unsafe' } };

    expect(() => answerText(answer as never)).toThrow('Text not available. Response was blocked due to SAFETY: unsafe');
  });
});
