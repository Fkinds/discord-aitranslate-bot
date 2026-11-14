import { describe, it, expect, beforeEach } from '@jest/globals';
import { LanguageCode } from '../../../../src/domain/language-code';
import { TranslationLanguages } from '../../../../src/domain/translation-languages';
import { OneAtATime } from '../../../../src/infrastructure/local/one-at-a-time';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import type { SpeechTranslation, Translator } from '../../../../src/usecases/ports/translator';
import { deferred } from '../../../support/deferred';
import { FakeLogger } from '../../../support/fakes/fake-logger';

const JA = TranslationLanguages.of(LanguageCode.of('ja'));
const speech = (bytes: number) => SpeechAudio.fromPcm(new Uint8Array(bytes));
const heard = (original: string): SpeechTranslation => ({ original, spokenLanguage: null, translations: [] });

/** A translator that finishes each utterance when the test says, recording which it has started. */
class StepTranslator implements Translator {
  readonly started: number[] = [];
  readonly finish: Array<ReturnType<typeof deferred<SpeechTranslation>>> = [];
  translate(audio: SpeechAudio): Promise<SpeechTranslation> {
    this.started.push(audio.pcm.byteLength);
    const step = deferred<SpeechTranslation>();
    this.finish.push(step);
    return step.promise;
  }
}

/** Let every promise that can settle, settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('OneAtATime', () => {
  let inner: StepTranslator;
  let now: number;
  let logger: FakeLogger;
  let translator: OneAtATime;

  beforeEach(() => {
    inner = new StepTranslator();
    now = 0;
    logger = new FakeLogger();
    translator = new OneAtATime(inner, () => new Date(now), logger);
  });

  it('starts an utterance only once the one before it is translated, in the order they came', async () => {
    const first = translator.translate(speech(2), JA);
    const second = translator.translate(speech(4), JA);
    await settle();
    expect(inner.started).toEqual([2]);

    inner.finish[0]!.resolve(heard('first'));
    await settle();
    expect(inner.started).toEqual([2, 4]);
    inner.finish[1]!.resolve(heard('second'));

    expect(await first).toEqual(heard('first'));
    expect(await second).toEqual(heard('second'));
  });

  it('goes on to the next utterance after one fails', async () => {
    const failing = translator.translate(speech(2), JA);
    const next = translator.translate(speech(4), JA);
    await settle();

    inner.finish[0]!.reject(new Error('failed'));
    await expect(failing).rejects.toThrow('failed');
    await settle();
    inner.finish[1]!.resolve(heard('next'));

    expect(await next).toEqual(heard('next'));
  });

  it('logs how long an utterance waited for those before it', async () => {
    void translator.translate(speech(2), JA);
    now = 300;
    void translator.translate(speech(4), JA);
    await settle();

    now = 1_500;
    inner.finish[0]!.resolve(heard('first'));
    await settle();

    expect(logger.entries).toEqual([
      { level: 'info', message: 'Translating after waiting for the utterances before it', meta: { waitedMs: 1_200 } },
    ]);
  });

  it('logs nothing for an utterance that did not wait', async () => {
    const first = translator.translate(speech(2), JA);
    await settle();
    inner.finish[0]!.resolve(heard('first'));
    await first;

    const second = translator.translate(speech(4), JA);
    await settle();
    inner.finish[1]!.resolve(heard('second'));
    await second;

    expect(logger.entries).toEqual([]);
  });
});
