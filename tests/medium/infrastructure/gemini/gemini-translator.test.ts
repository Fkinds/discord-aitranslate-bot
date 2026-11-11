import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { promptFor } from '../../../../src/infrastructure/gemini/gemini-reply';
import { GeminiTranslator, geminiModel } from '../../../../src/infrastructure/gemini/gemini-translator';
import { toWav } from '../../../../src/infrastructure/gemini/wav';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { HttpStub, type StubResponse } from '../../../support/http-stub';

const SPEECH = SpeechAudio.fromPcm(new Uint8Array([1, 2, 3, 4]));
const JA = LanguageCode.of('ja');
const REPLY = JSON.stringify({ transcription: 'Hello', translation: 'こんにちは', detectedLanguage: 'en', confidence: 0.9 });

/** A generateContent answer whose text is `text`. */
const answer = (text: string): StubResponse => ({
  status: 200,
  body: { candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] },
});
const failure = (status: number, reason: string): StubResponse => ({
  status,
  body: { error: { code: status, message: reason, status: reason } },
});

// The Gemini SDK and the adapter against a Gemini API stand-in on localhost.
describe('GeminiTranslator over HTTP', () => {
  let gemini: HttpStub;
  let translator: GeminiTranslator;

  beforeEach(async () => {
    gemini = await HttpStub.start();
    translator = new GeminiTranslator(geminiModel('test-key', 'gemini-test', gemini.url), { attempts: 3, delayMs: 0 }, new FakeLogger());
  });

  afterEach(async () => {
    await gemini.stop();
  });

  it('sends the prompt and the speech to generateContent with the API key, and reads the answer', async () => {
    gemini.respond(answer(REPLY));

    const translation = await translator.translate(SPEECH, JA);

    expect(translation).toEqual({ original: 'Hello', translated: 'こんにちは', detectedLanguage: 'en' });
    expect(gemini.requests).toHaveLength(1);
    const [request] = gemini.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/v1beta/models/gemini-test:generateContent');
    expect(request?.headers['x-goog-api-key']).toBe('test-key');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request?.body ?? '')).toMatchObject({
      contents: [
        {
          role: 'user',
          parts: [{ text: promptFor(JA) }, { inlineData: { mimeType: 'audio/wav', data: toWav(SPEECH).toString('base64') } }],
        },
      ],
    });
  });

  it('tries again after a server error', async () => {
    gemini.respond(failure(503, 'UNAVAILABLE'), answer(REPLY));

    await expect(translator.translate(SPEECH, JA)).resolves.toMatchObject({ translated: 'こんにちは' });
    expect(gemini.requests).toHaveLength(2);
  });

  it('tries a refused request again too, as the bot always has, then gives up', async () => {
    gemini.respond(failure(400, 'INVALID_ARGUMENT'), failure(400, 'INVALID_ARGUMENT'), failure(400, 'INVALID_ARGUMENT'));

    const error = await translator.translate(SPEECH, JA).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TranslationFailed);
    expect(String((error as TranslationFailed).cause)).toContain('400');
    expect(gemini.requests).toHaveLength(3);
  });

  it('takes a blocked answer, which has no text, as a failure', async () => {
    const blocked: StubResponse = { status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } };
    gemini.respond(blocked, blocked, blocked);

    const error = await translator.translate(SPEECH, JA).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TranslationFailed);
    expect(String((error as TranslationFailed).cause)).toContain('SAFETY');
  });
});
