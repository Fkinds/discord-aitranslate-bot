import type { TranslationLanguages } from '../../domain/translation-languages';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { TranslationFailed, type SpeechTranslation, type Translator } from '../../usecases/ports/translator';
import { HyMtTranslator, type TextTranslator } from './hy-mt-translator';
import { spokenLanguageAmong, WhisperRecognizer, type RecognizerOptions, type SpeechRecognizer } from './whisper-recognizer';

/**
 * Translates on this machine, sending nothing anywhere: Whisper hears what was
 * said and in which language, then Hy-MT2 translates it into each of the
 * session's languages that it is to be posted in. It translates into no other,
 * not even into the language that was spoken.
 */
export class LocalTranslator implements Translator {
  constructor(
    private readonly recognizer: SpeechRecognizer,
    private readonly translator: TextTranslator,
    private readonly onClose: () => Promise<void> = async () => {}
  ) {}

  /** Load the models from `modelsDir`, where `pnpm models:download` put them, both at once. */
  static async load(modelsDir: string, options: RecognizerOptions): Promise<LocalTranslator> {
    const [recognizer, translator] = await Promise.all([
      WhisperRecognizer.load(modelsDir, options),
      HyMtTranslator.load(modelsDir),
    ]);
    return new LocalTranslator(recognizer, translator, () => translator.close());
  }

  async translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    const heard = await this.recognizer.recognize(audio).catch((error: unknown) => {
      throw new TranslationFailed(`Hearing the speech failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    });
    if (heard.text === '') return { original: '', spokenLanguage: null, translations: [] };

    const spokenLanguage = spokenLanguageAmong(languages, heard.language);
    const translations = [];
    for (const language of languages.targetsFor(spokenLanguage)) {
      translations.push({ language, text: await this.translator.translate(heard.text, language) });
    }
    return { original: heard.text, spokenLanguage, translations };
  }

  /** Free the models. */
  async close(): Promise<void> {
    await this.onClose();
  }
}
