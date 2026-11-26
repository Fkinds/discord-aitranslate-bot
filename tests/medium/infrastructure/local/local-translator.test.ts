import { describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { ClaudeTextTranslator } from '../../../../src/infrastructure/claude/claude-text-translator';
import { LocalTranslator } from '../../../../src/infrastructure/local/local-translator';
import { WhisperRecognizer } from '../../../../src/infrastructure/local/whisper-recognizer';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { HttpStub } from '../../../support/http-stub';
import { LOCAL_MODEL_TIMEOUT_MS, localModelsDir } from '../../../support/local-models';
import { recordedSpeech } from '../../../support/recording';

const JA = LanguageCode.of('ja');
const KO = LanguageCode.of('ko');

// Whisper from the models pnpm models:download puts in models/, with Claude's
// translator against a stand-in for the Messages API on localhost.
describe('LocalTranslator, with Whisper and Claude', () => {
  let recognizer: WhisperRecognizer;
  let api: HttpStub;
  let translator: LocalTranslator;

  beforeAll(async () => {
    recognizer = await WhisperRecognizer.load(localModelsDir(), { threads: 4 });
  }, LOCAL_MODEL_TIMEOUT_MS);

  beforeEach(async () => {
    api = await HttpStub.start();
    const claude = new ClaudeTextTranslator('test-key', { timeoutMs: 1_000, maxRetries: 0, baseUrl: api.url }, new FakeLogger());
    translator = new LocalTranslator(recognizer, claude, () => new Date(), new FakeLogger(), { maxWaitMs: 10_000 });
  });

  afterEach(async () => {
    await api.stop();
  });

  it(
    'hears Japanese in a Japanese ⇄ Korean session, and has Claude translate what was heard into Korean only',
    async () => {
      api.respond({
        status: 200,
        body: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: '{"ko": "우리는 이와타 씨의 차를 타고 갔습니다."}' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 120, output_tokens: 30 },
        },
      });

      const translation = await translator.translate(recordedSpeech(), TranslationLanguages.of(JA, KO));

      expect(translation.original).toMatch(/岩田さんの車/);
      expect(translation.spokenLanguage).toBe(JA);
      expect(translation.translations).toEqual([{ language: KO, text: '우리는 이와타 씨의 차를 타고 갔습니다.' }]);
      const sent = JSON.parse(api.requests[0]!.body) as { messages: Array<{ content: string }> };
      expect(sent.messages[0]?.content).toMatch(/^Translate into Korean \(ko\)\.\n\n<text>\n.*岩田さんの車.*\n<\/text>$/s);
    },
    LOCAL_MODEL_TIMEOUT_MS
  );
});
