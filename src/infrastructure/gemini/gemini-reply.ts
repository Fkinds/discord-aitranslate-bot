import type { LanguageCode } from '../../domain/language-code';
import type { Translation } from '../../usecases/ports/translator';

/** What Gemini is asked to do with the audio, unchanged from the bot's first version. */
export function promptFor(targetLanguage: LanguageCode): string {
  return (
    `Transcribe the following audio (auto-detect language) and translate it to ${targetLanguage.tag}. ` +
    'Return the result in JSON format with keys: "transcription" (original text), ' +
    '"translation" (translated text), "detectedLanguage" (detected language code), ' +
    '"confidence" (confidence score between 0 and 1).'
  );
}

export type GeminiReply =
  | { readonly kind: 'json'; readonly translation: Translation; readonly confidence: unknown }
  | { readonly kind: 'unreadable'; readonly translation: Translation; readonly reason: string };

/** Stands in for the detected language when Gemini does not name one. */
const UNKNOWN_LANGUAGE = 'unknown';

/**
 * Read Gemini's reply to promptFor().
 *
 * The first {...} in the reply is taken as the JSON, so that a reply wrapped
 * in a code block or in prose is still read. A reply that is not the JSON
 * asked for is taken as both the transcription and the translation, as the
 * bot has always done.
 */
export function readReply(text: string): GeminiReply {
  const unreadable = (reason: string): GeminiReply => ({
    kind: 'unreadable',
    translation: { original: text, translated: text, detectedLanguage: UNKNOWN_LANGUAGE },
    reason,
  });

  let json: unknown;
  try {
    json = JSON.parse(text.match(/\{[\s\S]*?\}/)?.[0] ?? text);
  } catch (error) {
    return unreadable(error instanceof Error ? error.message : String(error));
  }
  if (typeof json !== 'object' || json === null) return unreadable('Not a JSON object');

  const { transcription, translation, detectedLanguage, confidence } = json as Record<string, unknown>;
  if (!isNonEmptyString(transcription) || !isNonEmptyString(translation)) {
    return unreadable('Missing required fields in response');
  }
  return {
    kind: 'json',
    translation: {
      original: transcription,
      translated: translation,
      detectedLanguage: typeof detectedLanguage === 'string' ? detectedLanguage : UNKNOWN_LANGUAGE,
    },
    confidence,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}
