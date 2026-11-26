import { describe, it, expect, beforeEach } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { LocalTranslator } from '../../../../src/infrastructure/local/local-translator';
import type { TextTranslator, TranslatedText } from '../../../../src/infrastructure/local/text-translator';
import type { Heard, SpeechRecognizer } from '../../../../src/infrastructure/local/whisper-recognizer';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const JA_KO = TranslationLanguages.of(JA, KO);
const SPEECH = SpeechAudio.fromPcm(new Uint8Array([1, 2, 3, 4]));

/** Hears what it is told to, or fails with what it is told to, recording the languages it was to tell it among. */
class FakeRecognizer implements SpeechRecognizer {
  heard: Heard | Error = { text: '', language: null };
  readonly among: string[][] = [];
  async recognize(_audio: SpeechAudio, among: readonly LanguageCode[] = []): Promise<Heard> {
    this.among.push(among.map((language) => language.tag));
    if (this.heard instanceof Error) throw this.heard;
    return this.heard;
  }
}

/** Translates "<text>" into "<text> in <tag>", recording the languages of each request, or fails with what it is told to. */
class FakeTextTranslator implements TextTranslator {
  readonly requests: Array<{ from: string | null; into: string[] }> = [];
  error: Error | undefined;
  async translate(text: string, from: LanguageCode | null, into: readonly LanguageCode[]): Promise<readonly TranslatedText[]> {
    this.requests.push({ from: from?.tag ?? null, into: into.map((language) => language.tag) });
    if (this.error) throw this.error;
    return into.map((language) => ({ language, text: `${text} in ${language.tag}` }));
  }
}

describe('LocalTranslator', () => {
  let recognizer: FakeRecognizer;
  let textTranslator: FakeTextTranslator;
  let translator: LocalTranslator;

  beforeEach(() => {
    recognizer = new FakeRecognizer();
    textTranslator = new FakeTextTranslator();
    translator = new LocalTranslator(recognizer, textTranslator);
  });

  it('translates what was said in one language of a pair into the other only', async () => {
    recognizer.heard = { text: '안녕하세요', language: 'ko' };

    expect(await translator.translate(SPEECH, JA_KO)).toEqual({
      original: '안녕하세요',
      spokenLanguage: KO,
      translations: [{ language: JA, text: '안녕하세요 in ja' }],
    });
    expect(textTranslator.requests).toEqual([{ from: 'ko', into: ['ja'] }]);
  });

  it("translates what was said in another language into each of the session's, in their order", async () => {
    recognizer.heard = { text: 'Hello', language: 'en' };

    const translation = await translator.translate(SPEECH, JA_KO);

    expect(translation.spokenLanguage).toBeNull();
    expect(translation.translations.map(({ language }) => language)).toEqual([JA, KO]);
    expect(textTranslator.requests).toEqual([{ from: 'en', into: ['ja', 'ko'] }]);
  });

  it.each([
    ['a language none of the commands offer', 'vi', 'vi'],
    ['a code that is not a language tag', 'not a tag', null],
    ['no language', null, null],
  ])('tells the text translator the language Whisper heard, given %s', async (_, heard, from) => {
    recognizer.heard = { text: 'Xin chào', language: heard };

    await translator.translate(SPEECH, JA_KO);

    expect(textTranslator.requests).toEqual([{ from, into: ['ja', 'ko'] }]);
  });

  it('translates nothing that was said in the one language of the session', async () => {
    recognizer.heard = { text: 'こんにちは', language: 'ja' };

    expect(await translator.translate(SPEECH, TranslationLanguages.of(JA))).toEqual({
      original: 'こんにちは',
      spokenLanguage: JA,
      translations: [],
    });
    expect(textTranslator.requests).toEqual([]);
  });

  it('has Whisper tell what was said between the two languages of a pair alone', async () => {
    recognizer.heard = { text: '안녕하세요', language: 'ko' };

    await translator.translate(SPEECH, JA_KO);

    expect(recognizer.among).toEqual([['ja', 'ko']]);
  });

  it('has Whisper tell what was said among any language with one language, in which anything may be said', async () => {
    recognizer.heard = { text: 'Hello', language: 'en' };

    await translator.translate(SPEECH, TranslationLanguages.of(JA));

    expect(recognizer.among).toEqual([[]]);
  });

  it('has Whisper tell among any language for a pair with a language it does not know by that tag', async () => {
    recognizer.heard = { text: '你好', language: 'zh' };

    await translator.translate(SPEECH, TranslationLanguages.of(JA, LanguageCode.of('zh-TW')));

    expect(recognizer.among).toEqual([[]]);
  });

  it('takes hangul Whisper heard as another language for Korean, and translates it from Korean', async () => {
    recognizer.heard = { text: '고마워', language: 'ja' };

    const translation = await translator.translate(SPEECH, JA_KO);

    expect(translation.spokenLanguage).toBe(KO);
    expect(translation.translations).toEqual([{ language: JA, text: '고마워 in ja' }]);
    expect(textTranslator.requests).toEqual([{ from: 'ko', into: ['ja'] }]);
  });

  it('translates nothing when no speech was heard', async () => {
    expect(await translator.translate(SPEECH, JA_KO)).toEqual({ original: '', spokenLanguage: null, translations: [] });
    expect(textTranslator.requests).toEqual([]);
  });

  it('fails when a translation fails', async () => {
    recognizer.heard = { text: 'Hello', language: 'en' };
    textTranslator.error = new TranslationFailed('The translation into ja ran on');

    await expect(translator.translate(SPEECH, JA_KO)).rejects.toThrow('The translation into ja ran on');
  });

  it('fails with TranslationFailed when hearing the speech fails', async () => {
    const cause = new Error('Whisper failed');
    recognizer.heard = cause;

    const translating = translator.translate(SPEECH, JA_KO);

    await expect(translating).rejects.toThrow(TranslationFailed);
    await expect(translating).rejects.toThrow('Hearing the speech failed: Whisper failed');
    await expect(translating).rejects.toHaveProperty('cause', cause);
  });
});
