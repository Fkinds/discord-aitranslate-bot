import { describe, it, expect, beforeEach } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { OllamaRequestFailed } from '../../../../src/infrastructure/ollama/ollama-client';
import { KEEP_THE_TONE } from '../../../../src/infrastructure/translategemma/prompt';
import { TranslateGemmaTextTranslator } from '../../../../src/infrastructure/translategemma/translategemma-text-translator';
import { TranslationFailed } from '../../../../src/usecases/ports/translator';
import { FakeLogger } from '../../../support/fakes/fake-logger';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');
const EN = LanguageCode.of('en');
const MODEL = 'translategemma:12b';

/** Answers each chat with the next answer it was given, recording the prompts; fails with an error given as an answer. */
class FakeOllama {
  readonly prompts: string[] = [];
  private readonly answers: Array<string | Error> = [];

  answer(...answers: Array<string | Error>): void {
    this.answers.push(...answers);
  }

  async chat(model: string, message: string): Promise<string> {
    expect(model).toBe(MODEL);
    this.prompts.push(message);
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error('FakeOllama has no answer left');
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

describe('TranslateGemmaTextTranslator', () => {
  let ollama: FakeOllama;
  let logger: FakeLogger;
  let translator: TranslateGemmaTextTranslator;

  beforeEach(() => {
    ollama = new FakeOllama();
    logger = new FakeLogger();
    translator = new TranslateGemmaTextTranslator(ollama, MODEL, logger);
  });

  it('translates into each language in turn, asking to keep the tone, and takes off the quotation marks', async () => {
    ollama.answer('"hey, can you hear me?"', '야, 들려?');

    const translations = await translator.translate('ねえ、聞こえる？', JA, [EN, KO]);

    expect(translations).toEqual([
      { language: EN, text: 'hey, can you hear me?' },
      { language: KO, text: '야, 들려?' },
    ]);
    expect(ollama.prompts).toHaveLength(2);
    expect(ollama.prompts[0]).toMatch(/^You are a professional Japanese \(ja\) to English \(en\) translator\./);
    expect(ollama.prompts[1]).toMatch(/^You are a professional Japanese \(ja\) to Korean \(ko\) translator\./);
    expect(ollama.prompts.every((prompt) => prompt.includes(KEEP_THE_TONE) && prompt.endsWith('\n\n\nねえ、聞こえる？'))).toBe(
      true
    );
    expect(logger.entries).toEqual([]);
  });

  it('asks nothing when there is no language to translate into', async () => {
    expect(await translator.translate('はい', JA, [])).toEqual([]);
    expect(ollama.prompts).toEqual([]);
  });

  it.each([
    ['a language none of the commands offer', LanguageCode.of('vi'), 'vi'],
    ['a language not known', null, 'unknown'],
  ])('translates into none of the languages from %s, and logs the language', async (_, from, language) => {
    expect(await translator.translate('Xin chào', from, [JA, KO])).toEqual([]);
    expect(ollama.prompts).toEqual([]);
    expect(logger.entries).toEqual([
      {
        level: 'debug',
        message: 'Not translating from a language TranslateGemma is not asked to translate from',
        meta: { language },
      },
    ]);
  });

  it("translates again with the model card's prompt when the translation looks wrong, logging why but not the text", async () => {
    ollama.answer('사사키 くん이 오면 나도 갈까', '사사키 군이 오면 나도 갈까');

    const translations = await translator.translate('佐々木くんが来るなら俺も行こうかな', JA, [KO]);

    expect(translations).toEqual([{ language: KO, text: '사사키 군이 오면 나도 갈까' }]);
    expect(ollama.prompts[1]).not.toContain(KEEP_THE_TONE);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        message: "TranslateGemma's translation looked wrong; translating again with the model card's prompt",
        meta: { from: 'ja', into: 'ko', problems: ['other-script'] },
      },
    ]);
  });

  it('posts the second translation as it is when it looks wrong too, and logs that', async () => {
    ollama.answer('정말 대단하다. (혹은) 진짜 최고다.', '정말 대단하다. (또는) 최고다.');

    const translations = await translator.translate('本当にすごい。最高。', JA, [KO]);

    expect(translations).toEqual([{ language: KO, text: '정말 대단하다. (또는) 최고다.' }]);
    expect(logger.entries.map(({ message, meta }) => [message, meta])).toEqual([
      [
        "TranslateGemma's translation looked wrong; translating again with the model card's prompt",
        { from: 'ja', into: 'ko', problems: ['added-parenthesis'] },
      ],
      ["TranslateGemma's translation still looks wrong; posting it as it is", { from: 'ja', into: 'ko', problems: ['added-parenthesis'] }],
    ]);
  });

  it('keeps the first translation when the second is empty', async () => {
    ollama.answer('응\n그래', '  ');

    expect(await translator.translate('うん', JA, [KO])).toEqual([{ language: KO, text: '응\n그래' }]);
  });

  it('leaves out a language whose translation is empty both times', async () => {
    ollama.answer('""', '', 'OK');

    expect(await translator.translate('うん', JA, [KO, EN])).toEqual([{ language: EN, text: 'OK' }]);
  });

  it('logs no text, whatever goes wrong', async () => {
    ollama.answer('사사키 くん이 오면', '사사키 くん이 오면');

    await translator.translate('佐々木くんが来るなら', JA, [KO]);

    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toMatch(/[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Han}]/u);
  });

  it('fails with TranslationFailed when Ollama fails, saying why', async () => {
    const cause = new OllamaRequestFailed('Ollama did not answer within 15000 ms', 'timeout');
    ollama.answer(cause);

    const error = await translator.translate('はい', JA, [KO]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TranslationFailed);
    expect(error).toMatchObject({
      message: 'Translating with TranslateGemma failed: Ollama did not answer within 15000 ms',
      cause,
    });
  });

  it('passes on any other failure as it is', async () => {
    const bug = new TypeError('a bug');
    ollama.answer(bug);

    await expect(translator.translate('はい', JA, [KO])).rejects.toBe(bug);
  });
});
