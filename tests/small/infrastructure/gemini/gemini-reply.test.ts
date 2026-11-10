import { describe, it, expect } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { promptFor, readReply } from '../../../../src/infrastructure/gemini/gemini-reply';

describe('promptFor', () => {
  it('asks for a transcription and a translation into the target language, as JSON', () => {
    expect(promptFor(LanguageCode.of('zh-TW'))).toBe(
      'Transcribe the following audio (auto-detect language) and translate it to zh-TW. ' +
        'Return the result in JSON format with keys: "transcription" (original text), ' +
        '"translation" (translated text), "detectedLanguage" (detected language code), ' +
        '"confidence" (confidence score between 0 and 1).'
    );
  });
});

describe('readReply', () => {
  const json = { transcription: 'Hello', translation: 'こんにちは', detectedLanguage: 'en', confidence: 0.9 };

  it('reads the JSON asked for', () => {
    expect(readReply(JSON.stringify(json))).toEqual({
      kind: 'json',
      translation: { original: 'Hello', translated: 'こんにちは', detectedLanguage: 'en' },
      confidence: 0.9,
    });
  });

  it('reads the JSON inside a code block or prose', () => {
    const reply = `Here you are:\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

    expect(readReply(reply)).toMatchObject({ kind: 'json', translation: { translated: 'こんにちは' } });
  });

  it('takes the detected language as unknown when Gemini names none', () => {
    const reply = JSON.stringify({ transcription: 'Hello', translation: 'こんにちは' });

    expect(readReply(reply)).toMatchObject({ kind: 'json', translation: { detectedLanguage: 'unknown' } });
  });

  it.each([
    ['plain text', 'こんにちは'],
    ['broken JSON', '{"transcription": "Hello", '],
    ['JSON without a translation', JSON.stringify({ transcription: 'Hello' })],
    ['JSON with an empty transcription', JSON.stringify({ transcription: '', translation: 'こんにちは' })],
    ['JSON with a translation that is not text', JSON.stringify({ transcription: 'Hello', translation: 42 })],
    ['JSON that is not an object', 'null'],
  ])('takes %s as both the transcription and the translation, as the bot always has', (_, reply) => {
    expect(readReply(reply)).toMatchObject({
      kind: 'unreadable',
      translation: { original: reply, translated: reply, detectedLanguage: 'unknown' },
    });
  });

  it('reads only up to the first closing brace, as the bot always has', () => {
    const nested = JSON.stringify({ transcription: 'Hello', translation: 'こんにちは', extra: { a: 1 } });

    expect(readReply(nested).kind).toBe('unreadable');
  });
});
