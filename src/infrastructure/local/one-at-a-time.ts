import type { TranslationLanguages } from '../../domain/translation-languages';
import type { Clock } from '../../usecases/ports/clock';
import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import type { SpeechTranslation, Translator } from '../../usecases/ports/translator';

/**
 * Hands the utterances to the translator one at a time, in the order they
 * came, so that the models on this machine work on one utterance at a time.
 * An utterance that had to wait for others logs how long it waited. One that
 * fails does not hold up the next.
 */
export class OneAtATime implements Translator {
  private previous: Promise<unknown> = Promise.resolve();
  private unfinished = 0;

  constructor(
    private readonly translator: Translator,
    private readonly clock: Clock,
    private readonly logger: Logger
  ) {}

  translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    const queuedAt = this.clock().getTime();
    const waits = this.unfinished > 0;
    this.unfinished++;

    const translation = this.previous.then(() => {
      if (waits) {
        this.logger.info('Translating after waiting for the utterances before it', {
          waitedMs: this.clock().getTime() - queuedAt,
        });
      }
      return this.translator.translate(audio, languages);
    });
    this.previous = translation.catch(() => undefined);
    return translation.finally(() => this.unfinished--);
  }
}
