import type { LanguageCode } from '../../domain/language-code';
import { englishNameOf } from '../local/languages';
import type { GlossaryMatch } from './glossary';

/**
 * The sentence added to the model card's prompt so that casual speech is not
 * made polite. In a trial with the 12B model, it kept 23 of 30 casual
 * sentences casual, against 11 of 30 without it (#86).
 */
export const KEEP_THE_TONE = 'Keep the speech level of the original: casual speech stays casual, polite speech stays polite.';

/** The sentence that asks for the terms of a glossary found in the text to be translated as it says. */
export function useTheseTerms(terms: readonly GlossaryMatch[]): string {
  return `Translate these terms as given: ${terms.map(({ said, translation }) => `${said} → ${translation}`).join('; ')}.`;
}

/**
 * What TranslateGemma is asked, as its model card writes it, with each language
 * named in English and by its ISO 639-1 code, such as "Korean (ko)". With
 * `keepTone`, the prompt also asks to keep the tone (KEEP_THE_TONE), and with
 * terms of a glossary, to translate them as it says (useTheseTerms), just
 * before it asks for the translation.
 *
 * @throws RangeError for a language the bot has no English name for.
 */
export function promptFor(
  text: string,
  from: LanguageCode,
  into: LanguageCode,
  keepTone: boolean,
  terms: readonly GlossaryMatch[] = []
): string {
  const source = englishNameOf(from);
  const target = englishNameOf(into);
  return (
    `You are a professional ${source} (${from.tag}) to ${target} (${into.tag}) translator. ` +
    `Your goal is to accurately convey the meaning and nuances of the original ${source} text ` +
    `while adhering to ${target} grammar, vocabulary, and cultural sensitivities.\n` +
    `Produce only the ${target} translation, without any additional explanations or commentary. ` +
    (keepTone ? `${KEEP_THE_TONE} ` : '') +
    (terms.length > 0 ? `${useTheseTerms(terms)} ` : '') +
    `Please translate the following ${source} text into ${target}:\n\n\n${text}`
  );
}
