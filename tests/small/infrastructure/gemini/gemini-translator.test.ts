import { describe, it, expect, beforeEach } from '@jest/globals';
import type { Part } from '@google/generative-ai';
import { LanguageCode } from '../../../../src/domain/language-code';
import { promptFor } from '../../../../src/infrastructure/gemini/gemini-reply';
import { type GeminiModel, GeminiTranslator, geminiModel } from '../../../../src/infrastructure/gemini/gemini-translator';
import { toWav } from '../../../../src/infrastructure/gemini/wav';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';
import { FakeLogger } from '../../../support/fakes/fake-logger';

/** Answers each request with the next of the replies it was given; an Error is thrown. */
class FakeGeminiModel implements GeminiModel {
  readonly requests: Part[][] = [];

  constructor(private readonly replies: Array<string | Error>) {}

  async generateContent(parts: Part[]): Promise<{ response: { text(): string } }> {
    this.requests.push(parts);
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error('no reply left');
    if (reply instanceof Error) throw reply;
    return { response: { text: () => reply } };
  }
}

const SPEECH = SpeechAudio.fromPcm(new Uint8Array([1, 2, 3, 4]));
const JA = LanguageCode.of('ja');
const REPLY = JSON.stringify({ transcription: 'Hello', translation: 'こんにちは', detectedLanguage: 'en', confidence: 0.9 });

describe('GeminiTranslator', () => {
  let logger: FakeLogger;
  let waits: number[];
  const noWait = async (ms: number) => {
    waits.push(ms);
  };

  const translatorFor = (model: GeminiModel, attempts = 3) =>
    new GeminiTranslator(model, { attempts, delayMs: 1000 }, logger, noWait);

  beforeEach(() => {
    logger = new FakeLogger();
    waits = [];
  });

  it('sends the prompt and the speech as a WAVE file, and returns the translation', async () => {
    const model = new FakeGeminiModel([REPLY]);

    const translation = await translatorFor(model).translate(SPEECH, JA);

    expect(model.requests).toEqual([
      [{ text: promptFor(JA) }, { inlineData: { mimeType: 'audio/wav', data: toWav(SPEECH).toString('base64') } }],
    ]);
    expect(translation).toEqual({ original: 'Hello', translated: 'こんにちは', detectedLanguage: 'en' });
    expect(logger.messages('info')).toEqual(['Translation completed']);
  });

  it('logs a reply it cannot read, and takes it as the translation', async () => {
    const translation = await translatorFor(new FakeGeminiModel(['こんにちは'])).translate(SPEECH, JA);

    expect(translation.translated).toBe('こんにちは');
    expect(logger.messages('warn')).toEqual(['Failed to parse JSON response, using fallback']);
  });

  it('tries again after waiting, whatever the failure', async () => {
    const model = new FakeGeminiModel([new Error('503 Service Unavailable'), new Error('400 Bad Request'), REPLY]);

    const translation = await translatorFor(model).translate(SPEECH, JA);

    expect(translation.translated).toBe('こんにちは');
    expect(model.requests).toHaveLength(3);
    expect(waits).toEqual([1000, 1000]);
    expect(logger.messages('warn')).toEqual(['Translation failed, retrying', 'Translation failed, retrying']);
  });

  it('fails with the last failure as the cause once every attempt has failed', async () => {
    const last = new Error('third');
    const model = new FakeGeminiModel([new Error('first'), new Error('second'), last]);

    const failure = await translatorFor(model)
      .translate(SPEECH, JA)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TranslationFailed);
    expect((failure as TranslationFailed).cause).toBe(last);
    expect(model.requests).toHaveLength(3);
    expect(waits).toEqual([1000, 1000]);
  });

  it('tries once when the policy says one attempt', async () => {
    const model = new FakeGeminiModel([new Error('down')]);

    await expect(translatorFor(model, 1).translate(SPEECH, JA)).rejects.toThrow(TranslationFailed);
    expect(waits).toEqual([]);
  });

  it.each([
    [{ attempts: 0, delayMs: 1000 }],
    [{ attempts: 1.5, delayMs: 1000 }],
    [{ attempts: 3, delayMs: -1 }],
    [{ attempts: 3, delayMs: Number.NaN }],
  ])('rejects the retry policy %j', (retry) => {
    expect(() => new GeminiTranslator(new FakeGeminiModel([]), retry, logger)).toThrow(RangeError);
  });
});

describe('geminiModel', () => {
  it('needs an API key', () => {
    expect(() => geminiModel('   ', 'gemini-2.0-flash-exp')).toThrow('Gemini API key is required');
  });

  it('makes a model without connecting', () => {
    expect(typeof geminiModel('test-key', 'gemini-2.0-flash-exp').generateContent).toBe('function');
  });
});
