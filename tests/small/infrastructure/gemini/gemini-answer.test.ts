import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { answerSchemaFor, instructionsFor, readAnswer } from '../../../../src/infrastructure/gemini/gemini-answer';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const JA_KO = TranslationLanguages.of(JA, KO);

describe('instructionsFor', () => {
  it('asks for a transcription and a translation into each language, by tag and name', () => {
    const instructions = instructionsFor(JA_KO);

    expect(instructions).toContain('Transcribe what is said in the audio');
    expect(instructions).toContain('ja (Japanese (日本語)), ko (Korean (한국어))');
  });
});

describe('answerSchemaFor', () => {
  it('asks for the transcription, the spoken language among the languages or "other", and a translation into each', () => {
    const schema = answerSchemaFor(JA_KO) as {
      properties: {
        spokenLanguage: { enum: string[] };
        translations: { properties: Record<string, unknown>; required: string[] };
      };
      required: string[];
    };

    expect(schema.required).toEqual(['transcription', 'spokenLanguage', 'translations']);
    expect(schema.properties.spokenLanguage.enum).toEqual(['ja', 'ko', 'other']);
    expect(Object.keys(schema.properties.translations.properties)).toEqual(['ja', 'ko']);
    expect(schema.properties.translations.required).toEqual(['ja', 'ko']);
  });

  it('uses only the JSON Schema keywords Gemini supports, and its propertyOrdering', () => {
    const supported = new Set([
      'type', 'description', 'enum', 'properties', 'required', 'minimum', 'maximum', 'propertyOrdering',
    ]);
    const keywords = (schema: Record<string, unknown>): string[] =>
      Object.entries(schema).flatMap(([key, value]) =>
        key === 'properties'
          ? Object.values(value as Record<string, Record<string, unknown>>).flatMap(keywords)
          : [key]
      );

    expect(keywords(answerSchemaFor(JA_KO)).filter((keyword) => !supported.has(keyword))).toEqual([]);
  });
});

describe('readAnswer', () => {
  const answer = (fields: Record<string, unknown>) =>
    JSON.stringify({ transcription: '안녕하세요', spokenLanguage: 'ko', translations: { ja: 'こんにちは', ko: '안녕하세요' }, ...fields });

  it('reads what was said, the spoken language, and the translations in the order of the languages', () => {
    const read = readAnswer(answer({ confidence: 0.9 }), JA_KO);

    expect(read.kind).toBe('read');
    if (read.kind !== 'read') return;
    expect(read.answer.transcription).toBe('안녕하세요');
    expect(read.answer.spokenLanguage?.equals(KO)).toBe(true);
    expect(read.answer.translations.map(({ language, text }) => [language.tag, text])).toEqual([
      ['ja', 'こんにちは'],
      ['ko', '안녕하세요'],
    ]);
    expect(read.answer.confidence).toBe(0.9);
  });

  it('takes "other" as a language that is none of the session\'s', () => {
    const read = readAnswer(answer({ transcription: 'Hello', spokenLanguage: 'other' }), JA_KO);

    expect(read).toMatchObject({ kind: 'read', answer: { spokenLanguage: null } });
  });

  it('reads an answer in which nothing was said', () => {
    const read = readAnswer(answer({ transcription: '', translations: { ja: '', ko: '' } }), JA_KO);

    expect(read).toMatchObject({ kind: 'read', answer: { transcription: '' } });
  });

  it('leaves out a confidence that is not a number', () => {
    const read = readAnswer(answer({ confidence: 'high' }), JA_KO);

    expect(read.kind === 'read' && 'confidence' in read.answer).toBe(false);
  });

  it.each([
    ['text that is not JSON', 'こんにちは', /^Not JSON/],
    ['JSON that is not an object', '["こんにちは"]', /^Not a JSON object$/],
    ['no transcription', answer({ transcription: undefined }), /^No transcription$/],
    ['a spoken language not asked about', answer({ spokenLanguage: 'en' }), /^Unknown spoken language "en"$/],
    ['no translations', answer({ translations: 'こんにちは' }), /^No translations$/],
    ['a language left out', answer({ translations: { ja: 'こんにちは' } }), /^No translation into ko$/],
    ['an empty translation of something said', answer({ translations: { ja: ' ', ko: '안녕하세요' } }), /^No translation into ja$/],
  ])('cannot read %s', (_, text, reason) => {
    const read = readAnswer(text, JA_KO);

    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' && read.reason).toMatch(reason);
  });
});
