import type { LanguageCode } from '../../domain/language-code';
import type { TranslationLanguages } from '../../domain/translation-languages';
import type { Clock } from '../../usecases/ports/clock';
import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import {
  TranslationAbandoned,
  TranslationFailed,
  type SpeechTranslation,
  type Translator,
} from '../../usecases/ports/translator';
import { languageByScript } from './language-by-script';
import { translatesInto } from './languages';
import { SerialQueue } from './serial-queue';
import type { TextTranslator, TranslatedText } from './text-translator';
import { languageHeard, spokenLanguageAmong, type SpeechRecognizer } from './whisper-recognizer';

/**
 * Hears speech on this machine, then has it translated: Whisper hears what was
 * said and in which language, then the text translator (Claude) translates it
 * from that language into each of the session's languages that it is to be
 * posted in. It translates into no other, not even into the language that was
 * spoken.
 *
 * With a pair of languages, Whisper tells what was said between the two of
 * them alone, so that a short utterance is not taken for a third language;
 * with one language, anything may be said, in any language. The letters of
 * what was heard then correct the language, where they tell Japanese and
 * Korean apart (languageByScript).
 *
 * Whisper hears one utterance at a time, and the text translator translates
 * one at a time, each in the order they came, so that the next utterance is
 * heard on the CPU while one is translated on the GPU, and they are done in
 * the order they came. An utterance that has waited `maxWaitMs` since it ended,
 * to be heard or translated, is given up on (TranslationAbandoned). One that
 * had to wait for others logs how long it waited.
 */
export class LocalTranslator implements Translator {
  private readonly hearing: SerialQueue;
  private readonly translating: SerialQueue;

  constructor(
    private readonly recognizer: SpeechRecognizer,
    private readonly translator: TextTranslator,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: LocalTranslatorOptions
  ) {
    this.hearing = new SerialQueue(clock);
    this.translating = new SerialQueue(clock);
  }

  async translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    const endedAt = this.clock().getTime();
    const heard = await this.hearing.run(
      () => {
        this.giveUpIfLate(endedAt);
        return this.recognizer.recognize(audio, whisperLanguagesFor(languages)).catch((error: unknown) => {
          throw new TranslationFailed(`Hearing the speech failed: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
          });
        });
      },
      (waitedMs) => this.logger.info('Hearing an utterance after waiting for those before it', { waitedMs })
    );
    if (heard.text === '') return { original: '', spokenLanguage: null, translations: [] };

    const language = languageByScript(heard.text, heard.language);
    const spokenLanguage = spokenLanguageAmong(languages, language);
    const targets = languages.targetsFor(spokenLanguage);
    // Even with nothing to translate, it waits its turn, so as to be done in the order they came.
    const translations = await this.translating.run(
      async (): Promise<readonly TranslatedText[]> => {
        this.giveUpIfLate(endedAt);
        return targets.length === 0 ? [] : this.translator.translate(heard.text, languageHeard(language), targets);
      },
      (waitedMs) => this.logger.info('Translating an utterance after waiting for those before it', { waitedMs })
    );
    return { original: heard.text, spokenLanguage, translations };
  }

  /** @throws TranslationAbandoned when the utterance that ended at `endedAt` has waited too long. */
  private giveUpIfLate(endedAt: number): void {
    const waitedMs = this.clock().getTime() - endedAt;
    if (waitedMs >= this.options.maxWaitMs) throw new TranslationAbandoned(waitedMs);
  }
}

export interface LocalTranslatorOptions {
  /** Give up on an utterance that has waited this long since it ended, to be heard or translated. */
  readonly maxWaitMs: number;
}

/** The languages for Whisper to tell what was said among: those of a pair that it knows; any, for one language. */
function whisperLanguagesFor(languages: TranslationLanguages): readonly LanguageCode[] {
  return languages.isPair && languages.languages.every(translatesInto) ? languages.languages : [];
}
