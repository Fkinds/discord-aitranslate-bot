import type { TranslationLanguages } from '../../domain/translation-languages';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { TranslationFailed, type SpeechTranslation, type Translator } from '../../usecases/ports/translator';
import type { TextTranslator } from './text-translator';
import { languageHeard, spokenLanguageAmong, type SpeechRecognizer } from './whisper-recognizer';

/**
 * Hears speech on this machine, then has it translated: Whisper hears what was
 * said and in which language, then the text translator (Claude) translates it
 * from that language into each of the session's languages that it is to be
 * posted in. It translates into no other, not even into the language that was
 * spoken.
 */
export class LocalTranslator implements Translator {
  constructor(
    private readonly recognizer: SpeechRecognizer,
    private readonly translator: TextTranslator
  ) {}

  async translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    const heard = await this.recognizer.recognize(audio).catch((error: unknown) => {
      throw new TranslationFailed(`Hearing the speech failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    });
    if (heard.text === '') return { original: '', spokenLanguage: null, translations: [] };

    const spokenLanguage = spokenLanguageAmong(languages, heard.language);
    const targets = languages.targetsFor(spokenLanguage);
    const translations =
      targets.length === 0 ? [] : await this.translator.translate(heard.text, languageHeard(heard.language), targets);
    return { original: heard.text, spokenLanguage, translations };
  }
}
