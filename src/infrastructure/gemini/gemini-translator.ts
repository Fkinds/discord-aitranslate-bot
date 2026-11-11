import { type GenerateContentResponse, GoogleGenAI, type Part } from '@google/genai';
import type { TranslationLanguages } from '../../domain/translation-languages';
import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { type SpeechTranslation, TranslationFailed, type Translator } from '../../usecases/ports/translator';
import { answerSchemaFor, instructionsFor, readAnswer } from './gemini-answer';
import { classifyFailure } from './gemini-failure';
import { toWav } from './wav';

/** The Gemini model, as this adapter uses it: parts in, the answer's text out, as JSON in the given schema. */
export interface GeminiModel {
  /** @throws AnswerBlocked when the answer was blocked; whatever the SDK throws when the request fails. */
  generateJson(parts: Part[], schema: Record<string, unknown>): Promise<string>;
}

/** Gemini answered, but in a form other than the one asked for. Asking again is not expected to help. */
export class AnswerUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Gemini answered, but blocked the answer, for example for safety. Asking again gets the same. */
export class AnswerBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface GeminiModelOptions {
  /** How long one request may take before it is abandoned. */
  readonly timeoutMs: number;
  /** Where the Gemini API is; Google's endpoint when omitted. */
  readonly baseUrl?: string;
}

/** The Gemini model to translate with. */
export function geminiModel(apiKey: string, modelName: string, { timeoutMs, baseUrl }: GeminiModelOptions): GeminiModel {
  if (apiKey.trim() === '') throw new Error('Gemini API key is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError(`timeoutMs must be a positive integer, got ${timeoutMs}`);
  }
  // Stated outright, so that the SDK's environment variables (such as
  // GOOGLE_GENAI_API_VERSION or GOOGLE_GENAI_USE_VERTEXAI) cannot change them.
  const ai = new GoogleGenAI({
    apiKey,
    vertexai: false,
    apiVersion: 'v1beta',
    httpOptions: { timeout: timeoutMs, ...(baseUrl ? { baseUrl } : {}) },
  });
  return {
    generateJson: async (parts, schema) =>
      answerText(
        await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json', responseJsonSchema: schema },
        })
      ),
  };
}

/** Finish reasons that mean the answer was blocked, as @google/generative-ai counted them. */
const BLOCKED_FINISH_REASONS: readonly string[] = ['RECITATION', 'SAFETY', 'LANGUAGE'];

/**
 * The text of Gemini's answer, read as the @google/generative-ai SDK read it:
 * the first candidate's text parts joined, or "" when there is no candidate.
 *
 * @throws AnswerBlocked when the answer was blocked, by its prompt feedback or
 *   by the first candidate's finish reason.
 */
export function answerText(answer: Pick<GenerateContentResponse, 'candidates' | 'promptFeedback'>): string {
  const [candidate] = answer.candidates ?? [];
  if (candidate) {
    if (candidate.finishReason && BLOCKED_FINISH_REASONS.includes(candidate.finishReason)) {
      throw new AnswerBlocked(`Candidate was blocked due to ${candidate.finishReason}`);
    }
    return (candidate.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('');
  }
  if (answer.promptFeedback) {
    const { blockReason, blockReasonMessage } = answer.promptFeedback;
    const reason = (blockReason ? ` due to ${blockReason}` : '') + (blockReasonMessage ? `: ${blockReasonMessage}` : '');
    throw new AnswerBlocked(`Text not available. Response was blocked${reason}`);
  }
  return '';
}

export interface RetryPolicy {
  /** How many times to try in all, at least 1. */
  readonly attempts: number;
  /** The wait before the second attempt; it doubles before each attempt after that. */
  readonly initialDelayMs: number;
  /** The longest wait Gemini may ask for; when it asks for longer, the bot gives up instead. */
  readonly maxAdvisedDelayMs: number;
}

/**
 * Translates speech with Gemini: the speech goes in as a WAVE file with the
 * instructions, and the answer comes back as JSON in the schema of
 * answerSchemaFor, read by readAnswer.
 *
 * A transient failure (see classifyFailure) is tried again under the retry
 * policy: after the wait Gemini asks for, or else after a wait that doubles
 * each time. Any other failure is given up on at once.
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
    for (const name of ['initialDelayMs', 'maxAdvisedDelayMs'] as const) {
      if (!(retry[name] >= 0)) throw new RangeError(`retry.${name} must not be negative, got ${retry[name]}`);
    }
    this.wait = wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.translateOnce(audio, languages);
      } catch (error) {
        const next = this.afterFailure(error, attempt);
        if ('giveUp' in next) throw new TranslationFailed(`Gemini failed to translate: ${next.giveUp}`, { cause: error });
        this.logger.warn('Translation failed, retrying', {
          attempt,
          attempts: this.retry.attempts,
          delayMs: next.retryAfterMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.wait(next.retryAfterMs);
      }
    }
  }

  /** Whether to try again after the attempt failed, and how long to wait first. */
  private afterFailure(error: unknown, attempt: number): { retryAfterMs: number } | { giveUp: string } {
    const failure = classifyFailure(error);
    if (failure.kind === 'permanent') return { giveUp: 'trying again would not help' };
    if (attempt >= this.retry.attempts) return { giveUp: `${attempt} attempts failed` };
    if (failure.advisedDelayMs === undefined) return { retryAfterMs: this.retry.initialDelayMs * 2 ** (attempt - 1) };
    if (failure.advisedDelayMs > this.retry.maxAdvisedDelayMs) {
      return { giveUp: `asked to wait ${failure.advisedDelayMs} ms, longer than ${this.retry.maxAdvisedDelayMs} ms` };
    }
    return { retryAfterMs: failure.advisedDelayMs };
  }

  private async translateOnce(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    const text = await this.model.generateJson(
      [{ text: instructionsFor(languages) }, { inlineData: { mimeType: 'audio/wav', data: toWav(audio).toString('base64') } }],
      answerSchemaFor(languages)
    );

    const read = readAnswer(text, languages);
    if (read.kind === 'unreadable') throw new AnswerUnreadable(`${read.reason}: ${text}`);
    const { transcription, spokenLanguage, translations, confidence } = read.answer;
    this.logger.info('Translation completed', {
      languages: languages.toString(),
      spokenLanguage: spokenLanguage?.tag ?? 'other',
      confidence,
    });
    return { original: transcription, spokenLanguage, translations };
  }
}
