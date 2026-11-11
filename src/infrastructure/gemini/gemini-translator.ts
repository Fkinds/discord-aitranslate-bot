import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import type { LanguageCode } from '../../domain/language-code';
import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { type Translation, TranslationFailed, type Translator } from '../../usecases/ports/translator';
import { promptFor, readReply } from './gemini-reply';
import { toWav } from './wav';

/** The part of the Gemini SDK's GenerativeModel this adapter uses. */
export interface GeminiModel {
  generateContent(parts: Part[]): Promise<{ response: { text(): string } }>;
}

/**
 * The Gemini model to translate with.
 * @param baseUrl where the Gemini API is; Google's endpoint when omitted.
 */
export function geminiModel(apiKey: string, modelName: string, baseUrl?: string): GeminiModel {
  if (apiKey.trim() === '') throw new Error('Gemini API key is required');
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName }, baseUrl ? { baseUrl } : undefined);
}

export interface RetryPolicy {
  /** How many times to try in all, at least 1. */
  readonly attempts: number;
  /** How long to wait before trying again. */
  readonly delayMs: number;
}

/**
 * Translates speech with Gemini: the speech goes in as a WAVE file with a
 * prompt asking for JSON, and the reply is read by readReply().
 *
 * Failures are tried again under the retry policy, whatever they are.
 */
export class GeminiTranslator implements Translator {
  private readonly wait: (ms: number) => Promise<void>;

  /** @param wait waits between attempts; tests pass one that does not. */
  constructor(
    private readonly model: GeminiModel,
    private readonly retry: RetryPolicy,
    private readonly logger: Logger,
    wait?: (ms: number) => Promise<void>
  ) {
    if (!Number.isInteger(retry.attempts) || retry.attempts < 1) {
      throw new RangeError(`retry.attempts must be an integer of at least 1, got ${retry.attempts}`);
    }
    if (!(retry.delayMs >= 0)) {
      throw new RangeError(`retry.delayMs must not be negative, got ${retry.delayMs}`);
    }
    this.wait = wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async translate(audio: SpeechAudio, targetLanguage: LanguageCode): Promise<Translation> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.translateOnce(audio, targetLanguage);
      } catch (error) {
        if (attempt >= this.retry.attempts) {
          throw new TranslationFailed(`Gemini failed to translate after ${attempt} attempts`, { cause: error });
        }
        this.logger.warn('Translation failed, retrying', {
          attempt,
          attempts: this.retry.attempts,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.wait(this.retry.delayMs);
      }
    }
  }

  private async translateOnce(audio: SpeechAudio, targetLanguage: LanguageCode): Promise<Translation> {
    const result = await this.model.generateContent([
      { text: promptFor(targetLanguage) },
      { inlineData: { mimeType: 'audio/wav', data: toWav(audio).toString('base64') } },
    ]);
    const text = result.response.text();

    const reply = readReply(text);
    if (reply.kind === 'unreadable') {
      this.logger.warn('Failed to parse JSON response, using fallback', { reason: reply.reason, responseText: text });
    }
    this.logger.info('Translation completed', {
      targetLanguage: targetLanguage.tag,
      detectedLanguage: reply.translation.detectedLanguage,
      confidence: reply.kind === 'json' ? reply.confidence : undefined,
    });
    return reply.translation;
  }
}
