import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { LanguageCode } from './domain/language-code';
import { blindOrder } from './infrastructure/evaluation/blind';
import { sentencesIn, type Sentence } from './infrastructure/evaluation/recordings';
import { englishNameOf } from './infrastructure/local/languages';
import type { TextTranslator } from './infrastructure/local/text-translator';
import { OllamaClient } from './infrastructure/ollama/ollama-client';
import { ollamaUrlFrom } from './infrastructure/ollama/ollama-host';
import { unquoted } from './infrastructure/translategemma/output-check';
import { TranslateGemmaTextTranslator } from './infrastructure/translategemma/translategemma-text-translator';
import type { Logger } from './usecases/ports/logger';

/** The models #119 compares: TranslateGemma 12B as the bot runs it, at Q8, and Gemma 4 12B. */
const DEFAULT_MODELS = ['translategemma:12b', 'translategemma:12b-it-q8_0', 'gemma4:12b-it-qat'];
/** The model that translates back, the same for every model compared. */
const BACK_MODEL = 'translategemma:12b';
/** How long a translation may take; a model may also be loaded first. */
const OLLAMA_OPTIONS = { timeoutMs: 120_000, retryDelayMs: 1_000 };

const USAGE = `Usage: pnpm eval:translation <directory> [--models <model>,<model>,...] [--back]

Has each model translate the sentences in <directory>/sentences.tsv (one a
line, the language and the text separated by a tab) into the other language of
the two, and writes:
  translations.md      each sentence with its translations as A, B, C..., in
                       an order shuffled for each sentence, to judge blind
  translations-key.md  which model each letter is, and how long each took
With --back, each translation is also translated back with ${BACK_MODEL}, for a
rough check by someone who reads only the source language.
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

async function evaluate(dir: string, models: readonly string[], back: boolean): Promise<void> {
  const sentences = sentencesIn(await readFile(path.join(dir, 'sentences.tsv'), 'utf8'));
  const languages = [...new Set(sentences.map((sentence) => sentence.language))];
  if (languages.length !== 2) throw new Error(`sentences.tsv must be in two languages, got ${languages.join(', ')}`);
  const other = (sentence: Sentence) => LanguageCode.of(languages.find((language) => language !== sentence.language)!);

  const ollama = new OllamaClient(ollamaUrlFrom(process.env.OLLAMA_HOST || undefined), OLLAMA_OPTIONS);
  const backTranslator = new TranslateGemmaTextTranslator(ollama, BACK_MODEL, new CountingLogger());

  const results = new Map<string, Translation[]>();
  const wrong = new Map<string, number>();
  for (const model of models) {
    const logger = new CountingLogger();
    const translator = model.startsWith('translategemma')
      ? new TranslateGemmaTextTranslator(ollama, model, logger)
      : new GeneralModelTranslator(ollama, model);
    console.log(`Translating ${sentences.length} sentences with ${model}`);
    const translations: Translation[] = [];
    for (const sentence of sentences) {
      const from = LanguageCode.of(sentence.language);
      const started = performance.now();
      const [translated] = await translator.translate(sentence.text, from, [other(sentence)]);
      const ms = performance.now() - started;
      translations.push({ text: translated?.text ?? '', ms });
    }
    await ollama.unload(model);
    results.set(model, translations);
    wrong.set(model, logger.wrong);
  }

  if (back) {
    console.log(`Translating back with ${BACK_MODEL}`);
    for (const [model, translations] of results) {
      results.set(
        model,
        await Promise.all(
          translations.map(async (translation, i) => {
            const sentence = sentences[i]!;
            const [returned] = await backTranslator.translate(translation.text, other(sentence), [LanguageCode.of(sentence.language)]);
            return { ...translation, back: returned?.text ?? '' };
          })
        )
      );
    }
    await ollama.unload(BACK_MODEL);
  }

  const letters = models.map((_, i) => String.fromCharCode(65 + i));
  const blind = [`# Translations to judge\n`, `Each sentence, then its translations in an order shuffled for it.\n`];
  const key = [`# Which model each letter is\n`, `| # | ${letters.join(' | ')} |`, `|---|${letters.map(() => '---').join('|')}|`];
  for (const [i, sentence] of sentences.entries()) {
    const order = blindOrder(models.length, i + 1);
    blind.push(`## ${i + 1}. ${sentence.language} → ${other(sentence).tag}\n\n${sentence.text}\n`);
    for (const [place, index] of order.entries()) {
      const translation = results.get(models[index]!)![i]!;
      blind.push(`- **${letters[place]}:** ${translation.text}${translation.back === undefined ? '' : ` (back: ${translation.back})`}`);
    }
    blind.push('');
    key.push(`| ${i + 1} | ${order.map((index) => models[index]).join(' | ')} |`);
  }
  key.push(`\n| Model | Median time a sentence | Looked wrong, so translated again |\n|---|---|---|`);
  for (const model of models) {
    const times = results.get(model)!.map((translation) => translation.ms).sort((a, b) => a - b);
    const median = times[Math.floor((times.length - 1) / 2)] ?? 0;
    key.push(`| ${model} | ${Math.round(median)} ms | ${model.startsWith('translategemma') ? wrong.get(model) : '—'} |`);
  }

  await writeFile(path.join(dir, 'translations.md'), blind.join('\n'));
  await writeFile(path.join(dir, 'translations-key.md'), `${key.join('\n')}\n`);
  console.log(`Wrote ${path.join(dir, 'translations.md')} and ${path.join(dir, 'translations-key.md')}`);
}

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const args = process.argv.slice(2);
  const modelsAt = args.indexOf('--models');
  const models = modelsAt < 0 ? DEFAULT_MODELS : (args[modelsAt + 1] ?? '').split(',').filter(Boolean);
  const dir = args.find((arg, i) => !arg.startsWith('--') && !(modelsAt >= 0 && i === modelsAt + 1));
  if (!dir || models.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  await evaluate(path.resolve(dir), models, args.includes('--back'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
