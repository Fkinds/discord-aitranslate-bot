import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { LanguageCode } from './domain/language-code';
import { blindOrder } from './infrastructure/evaluation/blind';
import { sentencesIn, type Sentence } from './infrastructure/evaluation/recordings';
import { allTheSame, type Variant, variantName, variantsOf } from './infrastructure/evaluation/variants';
import { englishNameOf } from './infrastructure/local/languages';
import type { TextTranslator } from './infrastructure/local/text-translator';
import { OllamaClient } from './infrastructure/ollama/ollama-client';
import { ollamaUrlFrom } from './infrastructure/ollama/ollama-host';
import { Glossary } from './infrastructure/translategemma/glossary';
import { unquoted } from './infrastructure/translategemma/output-check';
import { TranslateGemmaTextTranslator } from './infrastructure/translategemma/translategemma-text-translator';
import type { Logger } from './usecases/ports/logger';

/** The models #119 compares: TranslateGemma 12B as the bot runs it, at Q8, and Gemma 4 12B. */
const DEFAULT_MODELS = ['translategemma:12b', 'translategemma:12b-it-q8_0', 'gemma4:12b-it-qat'];
/** The model that translates back, the same for every model compared. */
const BACK_MODEL = 'translategemma:12b';
/** How long a translation may take; a model may also be loaded first. */
const OLLAMA_OPTIONS = { timeoutMs: 120_000, retryDelayMs: 1_000 };
/** The languages of the glossary's two columns. */
const GLOSSARY_LANGUAGES = [LanguageCode.of('ja'), LanguageCode.of('ko')] as const;

const USAGE = `Usage: pnpm eval:translation <directory> [--models <model>,<model>,...] [--back] [--glossary <file>]

Has each model translate the sentences in <directory>/sentences.tsv (one a
line, the language and the text separated by a tab) into the other language of
the two, and writes:
  translations.md      each sentence with its translations as A, B, C..., in
                       an order shuffled for each sentence, to judge blind
  translations-key.md  which model each letter is, and how long each took
With --back, each translation is also translated back with ${BACK_MODEL}, for a
rough check by someone who reads only the source language.
With --glossary, each TranslateGemma model also translates with the glossary
in <file> (a term a line, Japanese and Korean separated by a tab), asked to
translate the terms found in each sentence as it says; the key lists them.
Models: ${DEFAULT_MODELS.join(', ')} by default; Ollama must have them.`;

/**
 * Asks a general model to translate, as the bot would ask one in place of
 * TranslateGemma: the same languages, the same tone, the translation alone.
 */
class GeneralModelTranslator implements TextTranslator {
  constructor(
    private readonly ollama: OllamaClient,
    private readonly model: string
  ) {}

  async translate(text: string, from: LanguageCode | null, into: readonly LanguageCode[]) {
    const source = from ? englishNameOf(from) : 'the original';
    const results = [];
    for (const language of into) {
      const target = englishNameOf(language);
      const prompt =
        `Translate the following ${source} text into ${target}. It was said aloud in a voice chat, so keep its speech ` +
        'level: casual speech stays casual, polite speech stays polite. Keep names as they are. ' +
        `Reply with the ${target} translation alone, without notes or quotation marks.\n\n${text}`;
      results.push({ language, text: unquoted(await this.ollama.chat(this.model, prompt)) });
    }
    return results;
  }
}

/** A logger that counts the translations TranslateGemma found wrong, for the key. */
class CountingLogger implements Logger {
  wrong = 0;
  error(): void {}
  warn(message: string): void {
    if (message.startsWith("TranslateGemma's translation looked wrong")) this.wrong++;
  }
  info(): void {}
  debug(): void {}
}

interface Translation {
  readonly text: string;
  readonly back?: string;
  readonly ms: number;
}

async function evaluate(dir: string, models: readonly string[], back: boolean, glossary: Glossary | undefined): Promise<void> {
  const sentences = sentencesIn(await readFile(path.join(dir, 'sentences.tsv'), 'utf8'));
  const languages = [...new Set(sentences.map((sentence) => sentence.language))];
  if (languages.length !== 2) throw new Error(`sentences.tsv must be in two languages, got ${languages.join(', ')}`);
  const other = (sentence: Sentence) => LanguageCode.of(languages.find((language) => language !== sentence.language)!);

  const ollama = new OllamaClient(ollamaUrlFrom(process.env.OLLAMA_HOST || undefined), OLLAMA_OPTIONS);
  const backTranslator = new TranslateGemmaTextTranslator(ollama, BACK_MODEL, new CountingLogger());

  const variants = variantsOf(models, glossary !== undefined);
  const names = variants.map(variantName);
  const translatorFor = (variant: Variant, logger: Logger): TextTranslator =>
    variant.model.startsWith('translategemma')
      ? new TranslateGemmaTextTranslator(ollama, variant.model, logger, variant.glossary ? glossary : undefined)
      : new GeneralModelTranslator(ollama, variant.model);

  const results = new Map<string, Translation[]>();
  const wrong = new Map<string, number>();
  for (const [v, variant] of variants.entries()) {
    const logger = new CountingLogger();
    const translator = translatorFor(variant, logger);
    console.log(`Translating ${sentences.length} sentences with ${variantName(variant)}`);
    const translations: Translation[] = [];
    for (const sentence of sentences) {
      const from = LanguageCode.of(sentence.language);
      const started = performance.now();
      const [translated] = await translator.translate(sentence.text, from, [other(sentence)]);
      const ms = performance.now() - started;
      translations.push({ text: translated?.text ?? '', ms });
    }
    // A model with the glossary comes right after it: keep it loaded for that.
    if (variants[v + 1]?.model !== variant.model) await ollama.unload(variant.model);
    results.set(variantName(variant), translations);
    wrong.set(variantName(variant), logger.wrong);
  }

  if (back) {
    console.log(`Translating back with ${BACK_MODEL}`);
    // One at a time, as the translations were: sent all at once, the requests
    // wait in Ollama for those before them, and the last ones time out.
    for (const [name, translations] of results) {
      const returned: Translation[] = [];
      for (const [i, translation] of translations.entries()) {
        const sentence = sentences[i]!;
        const [translatedBack] = await backTranslator.translate(translation.text, other(sentence), [LanguageCode.of(sentence.language)]);
        returned.push({ ...translation, back: translatedBack?.text ?? '' });
      }
      results.set(name, returned);
    }
    await ollama.unload(BACK_MODEL);
  }

  const letters = names.map((_, i) => String.fromCharCode(65 + i));
  const termsColumn = glossary ? ' Terms found |' : '';
  const blind = [`# Translations to judge\n`, `Each sentence, then its translations in an order shuffled for it.\n`];
  const key = [
    `# Which model each letter is\n`,
    `| # | ${letters.join(' | ')} |${termsColumn}`,
    `|---|${letters.map(() => '---').join('|')}|${glossary ? '---|' : ''}`,
  ];
  const shown = (translation: Translation) => `${translation.text}${translation.back === undefined ? '' : ` (back: ${translation.back})`}`;
  let same = 0;
  for (const [i, sentence] of sentences.entries()) {
    const order = blindOrder(names.length, i + 1);
    const translations = names.map((name) => results.get(name)![i]!);
    blind.push(`## ${i + 1}. ${sentence.language} → ${other(sentence).tag}\n\n${sentence.text}\n`);
    if (allTheSame(translations.map((translation) => translation.text))) {
      // Nothing to tell between them, so nothing to judge.
      same++;
      blind.push(`- **All the same:** ${shown(translations[0]!)}`);
    } else {
      for (const [place, index] of order.entries()) blind.push(`- **${letters[place]}:** ${shown(translations[index]!)}`);
    }
    blind.push('');
    const terms = glossary?.termsIn(sentence.text, LanguageCode.of(sentence.language), other(sentence)) ?? [];
    const found = terms.map(({ said, translation }) => `${said} → ${translation}`).join(', ') || '—';
    key.push(`| ${i + 1} | ${order.map((index) => names[index]).join(' | ')} |${glossary ? ` ${found} |` : ''}`);
  }
  key.push(`\nAll the same, so not to judge: ${same} of ${sentences.length} sentences.`);
  key.push(`\n| Model | Median time a sentence | Looked wrong, so translated again |\n|---|---|---|`);
  for (const [v, variant] of variants.entries()) {
    const name = names[v]!;
    const times = results.get(name)!.map((translation) => translation.ms).sort((a, b) => a - b);
    const median = times[Math.floor((times.length - 1) / 2)] ?? 0;
    key.push(`| ${name} | ${Math.round(median)} ms | ${variant.model.startsWith('translategemma') ? wrong.get(name) : '—'} |`);
  }

  await writeFile(path.join(dir, 'translations.md'), blind.join('\n'));
  await writeFile(path.join(dir, 'translations-key.md'), `${key.join('\n')}\n`);
  console.log(`Wrote ${path.join(dir, 'translations.md')} and ${path.join(dir, 'translations-key.md')}`);
}

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const args = process.argv.slice(2);
  const valueOf = (option: string) => (args.includes(option) ? (args[args.indexOf(option) + 1] ?? '') : undefined);
  const values = ['--models', '--glossary'].filter((option) => args.includes(option)).map((option) => args.indexOf(option) + 1);
  const models = (valueOf('--models') ?? DEFAULT_MODELS.join(',')).split(',').filter(Boolean);
  const glossaryFile = valueOf('--glossary');
  const dir = args.find((arg, i) => !arg.startsWith('--') && !values.includes(i));
  if (!dir || models.length === 0 || glossaryFile === '') {
    console.error(USAGE);
    process.exit(2);
  }
  const glossary =
    glossaryFile === undefined ? undefined : Glossary.parse(await readFile(path.resolve(glossaryFile), 'utf8'), GLOSSARY_LANGUAGES);
  if (glossary) console.log(`Read ${glossary.size} terms from ${glossaryFile}`);
  await evaluate(path.resolve(dir), models, args.includes('--back'), glossary);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
