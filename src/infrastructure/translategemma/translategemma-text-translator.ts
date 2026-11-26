import type { LanguageCode } from '../../domain/language-code';
import type { Logger } from '../../usecases/ports/logger';
import { TranslationFailed } from '../../usecases/ports/translator';
import { translatesInto } from '../local/languages';
import type { TextTranslator, TranslatedText } from '../local/text-translator';
import { OllamaRequestFailed, type OllamaClient } from '../ollama/ollama-client';
import { problemsOf, unquoted } from './output-check';
import { promptFor } from './prompt';

/**
 * Translates with TranslateGemma on Ollama, into one language at a time, in
 * the order of the languages, as the model translates into one per prompt.
 *
 * It asks for the tone of the original to be kept. When the translation looks
 * wrong (problemsOf), it asks once more with the model card's prompt alone,
 * and takes that translation even if it looks wrong too, unless it is empty.
 * A translation that is empty either way is left out.
 *
 * It translates only from the languages offered in the commands, which it
 * can name: from any other, or from a language not known, it translates into
 * none, so that nothing is posted.
 *
 * It logs what looked wrong, and the languages, but never the text.
 */
export class TranslateGemmaTextTranslator implements TextTranslator {
  constructor(
    private readonly ollama: Pick<OllamaClient, 'chat'>,
    private readonly model: string,
    private readonly logger: Logger
  ) {}

  async translate(text: string, from: LanguageCode | null, into: readonly LanguageCode[]): Promise<readonly TranslatedText[]> {
    if (into.length === 0) return [];
    if (from === null || !translatesInto(from)) {
      this.logger.debug('Not translating from a language TranslateGemma is not asked to translate from', {
        language: from?.tag ?? 'unknown',
      });
      return [];
    }

    const translations: TranslatedText[] = [];
    for (const language of into) {
      const translated = await this.translateInto(text, from, language);
      if (translated !== '') translations.push({ language, text: translated });
    }
    return translations;
  }

  private async translateInto(text: string, from: LanguageCode, into: LanguageCode): Promise<string> {
    const languages = { from: from.tag, into: into.tag };
    const first = unquoted(await this.ask(promptFor(text, from, into, true)));
    const problems = problemsOf(text, first, from, into);
    if (problems.length === 0) return first;

    this.logger.warn("TranslateGemma's translation looked wrong; translating again with the model card's prompt", {
      ...languages,
      problems,
    });
    const second = unquoted(await this.ask(promptFor(text, from, into, false)));
    const remaining = problemsOf(text, second, from, into);
    if (remaining.length > 0) {
      this.logger.warn("TranslateGemma's translation still looks wrong; posting it as it is", {
        ...languages,
        problems: remaining,
      });
    }
    return second === '' ? first : second;
  }

  private async ask(prompt: string): Promise<string> {
    try {
      return await this.ollama.chat(this.model, prompt);
    } catch (error) {
      if (!(error instanceof OllamaRequestFailed)) throw error;
      throw new TranslationFailed(`Translating with TranslateGemma failed: ${error.message}`, { cause: error });
    }
  }
}
