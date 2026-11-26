import type { LanguageCode } from '../../domain/language-code';
import type { TranslationLanguages } from '../../domain/translation-languages';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { TranslationFailed, type SpeechTranslation, type Translator } from '../../usecases/ports/translator';
import { languageByScript } from './language-by-script';
import { translatesInto } from './languages';
import type { TextTranslator } from './text-translator';
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
 */
export class LocalTranslator implements Translator {
  constructor(
    private readonly recognizer: SpeechRecognizer,
    private readonly translator: TextTranslator
  ) {}

  async translate(audio: SpeechAudio, languages: TranslationLanguages): Promise<SpeechTranslation> {
    const heard = await this.recognizer.recognize(audio, whisperLanguagesFor(languages)).catch((error: unknown) => {
      throw new TranslationFailed(`Hearing the speech failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    });
    if (heard.text === '') return { original: '', spokenLanguage: null, translations: [] };

    const language = languageByScript(heard.text, heard.language);
    const spokenLanguage = spokenLanguageAmong(languages, language);
    const targets = languages.targetsFor(spokenLanguage);
    const translations =
      targets.length === 0 ? [] : await this.translator.translate(heard.text, languageHeard(language), targets);
    return { original: heard.text, spokenLanguage, translations };
  }
}

/** The languages for Whisper to tell what was said among: those of a pair that it knows; any, for one language. */
function whisperLanguagesFor(languages: TranslationLanguages): readonly LanguageCode[] {
  return languages.isPair && languages.languages.every(translatesInto) ? languages.languages : [];
}
