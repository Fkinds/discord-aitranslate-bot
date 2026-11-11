import type { LanguageCode } from '../../domain/language-code';
import type { TranslationLanguages } from '../../domain/translation-languages';

/** What Gemini answers for the speech: what was said, in which language, and its translations. */
export interface GeminiAnswer {
  /** What was said, word for word; empty when nothing was said. */
  readonly transcription: string;
  /** The session's language that was spoken, or null for any other language. */
  readonly spokenLanguage: LanguageCode | null;
  /** What was said in each of the session's languages, in their order; empty texts when nothing was said. */
  readonly translations: ReadonlyArray<{ readonly language: LanguageCode; readonly text: string }>;
  /** How sure Gemini is, from 0 to 1, if it said; for the logs. */
  readonly confidence?: number;
}

/** Stands for a spoken language that is none of the session's. */
const OTHER = 'other';

/** What Gemini is asked to do with the speech; the answer's form is set by answerSchemaFor. */
export function instructionsFor(languages: TranslationLanguages): string {
  const listed = languages.languages.map((language) => `${language.tag} (${language.displayName})`).join(', ');
  return (
    'Transcribe what is said in the audio, word for word, in the language it is said in. ' +
    `Then translate it into each of these languages: ${listed}. ` +
    'Translate the meaning as a person would say it in conversation. ' +
    'If nothing is said, leave the transcription and the translations empty.'
  );
}

/**
 * The JSON Schema of the answer, for responseJsonSchema. It uses only the
 * keywords Gemini supports, plus Gemini's propertyOrdering, so that the
 * transcription comes before the translations.
 */
export function answerSchemaFor(languages: TranslationLanguages): Record<string, unknown> {
  const tags = languages.languages.map((language) => language.tag);
  return {
    type: 'object',
    properties: {
      transcription: { type: 'string', description: 'What was said, word for word, in the language it was said in.' },
      spokenLanguage: {
        type: 'string',
        enum: [...tags, OTHER],
        description: `The language that was spoken: one of ${tags.join(', ')}, or "${OTHER}" for any other language.`,
      },
      translations: {
        type: 'object',
        properties: Object.fromEntries(
          languages.languages.map((language) => [
            language.tag,
            { type: 'string', description: `What was said, in ${language.displayName}.` },
          ])
        ),
        required: tags,
        propertyOrdering: tags,
      },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How sure you are of the transcription.' },
    },
    required: ['transcription', 'spokenLanguage', 'translations'],
    propertyOrdering: ['transcription', 'spokenLanguage', 'translations', 'confidence'],
  };
}

/**
 * Read Gemini's answer to instructionsFor, in the form of answerSchemaFor.
 * An answer in any other form is unreadable: it is not taken as text to post.
 */
export function readAnswer(
  text: string,
  languages: TranslationLanguages
): { readonly kind: 'read'; readonly answer: GeminiAnswer } | { readonly kind: 'unreadable'; readonly reason: string } {
  const unreadable = (reason: string) => ({ kind: 'unreadable', reason }) as const;

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return unreadable(`Not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(json)) return unreadable('Not a JSON object');

  const { transcription, spokenLanguage, translations, confidence } = json;
  if (typeof transcription !== 'string') return unreadable('No transcription');
  const spoken = languages.languages.find((language) => language.tag === spokenLanguage);
  if (!spoken && spokenLanguage !== OTHER) return unreadable(`Unknown spoken language ${JSON.stringify(spokenLanguage)}`);
  if (!isRecord(translations)) return unreadable('No translations');

  const said = transcription.trim() !== '';
  const read: Array<{ language: LanguageCode; text: string }> = [];
  for (const language of languages.languages) {
    const translation = translations[language.tag];
    if (typeof translation !== 'string' || (said && translation.trim() === '')) {
      return unreadable(`No translation into ${language.tag}`);
    }
    read.push({ language, text: translation });
  }

  return {
    kind: 'read',
    answer: {
      transcription,
      spokenLanguage: spoken ?? null,
      translations: read,
      ...(typeof confidence === 'number' ? { confidence } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
