import { describe, it, expect, beforeEach } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import type { TextTranslator } from '../../../../src/infrastructure/local/hy-mt-translator';
import { LocalTranslator } from '../../../../src/infrastructure/local/local-translator';
import type { Heard, SpeechRecognizer } from '../../../../src/infrastructure/local/whisper-recognizer';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const JA_KO = TranslationLanguages.of(JA, KO);
const SPEECH = SpeechAudio.fromPcm(new Uint8Array([1, 2, 3, 4]));

/** Hears what it is told to, or fails with what it is told to. */
class FakeRecognizer implements SpeechRecognizer {
  heard: Heard | Error = { text: '', language: null };
  async recognize(): Promise<Heard> {
    if (this.heard instanceof Error) throw this.heard;
    return this.heard;
  }
}

/** Translates "<text>" into "<text> in <tag>", recording each request, or fails with what it is told to. */
class FakeTextTranslator implements TextTranslator {
  readonly requests: string[] = [];
  error: Error | undefined;
  async translate(text: string, into: LanguageCode): Promise<string> {
    this.requests.push(into.tag);
    if (this.error) throw this.error;
    return `${text} in ${into.tag}`;
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
  });

  it("translates what was said in another language into each of the session's, in their order", async () => {
    recognizer.heard = { text: 'Hello', language: 'en' };

    const translation = await translator.translate(SPEECH, JA_KO);

    expect(translation.spokenLanguage).toBeNull();
    expect(translation.translations.map(({ language }) => language)).toEqual([JA, KO]);
    expect(textTranslator.requests).toEqual(['ja', 'ko']);
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
