import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LanguageCode } from '../../domain/language-code';
import { TranslationFailed } from '../../usecases/ports/translator';
import { TRANSLATION_MODEL } from './model-files';

/** Translates text that was said into another language. */
export interface TextTranslator {
  /** @throws TranslationFailed when it could not be translated. */
  translate(text: string, into: LanguageCode): Promise<string>;
}

/** The English names of the languages offered in the commands, as Hy-MT2's prompts name languages. */
const LANGUAGE_NAMES: ReadonlyMap<string, string> = new Map([
  ['ja', 'Japanese'],
  ['en', 'English'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
]);

/** Whether the local translator translates into the language: it does into those offered in the commands. */
export function translatesInto(language: LanguageCode): boolean {
  return LANGUAGE_NAMES.has(language.tag);
}

/** The prompt that Hy-MT2's model card gives for translating, in English. */
export function promptFor(text: string, into: LanguageCode): string {
  const name = LANGUAGE_NAMES.get(into.tag);
  if (name === undefined) throw new RangeError(`The local translator does not translate into ${into.tag}`);
  return `Translate the following text into ${name}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;
}

/**
 * The most tokens a translation of the text may take. It is well over the
 * length of any translation of it, so a translation that reaches it has run
 * on, repeating itself or adding to what was said.
 */
export function tokenLimitFor(text: string): number {
  return 2 * [...text].length + 32;
}

/** What the worker thread answers to a prompt. */
export type ModelAnswer = { readonly text: string; readonly stopReason: string } | { readonly error: string };

/**
 * The translation in the model's answer.
 * @throws TranslationFailed when the model failed, ran on to the token limit, or said nothing.
 */
export function translationFrom(answer: ModelAnswer, into: LanguageCode, tokenLimit: number): string {
  if ('error' in answer) throw new TranslationFailed(`Translating into ${into.tag} failed: ${answer.error}`);
  if (answer.stopReason === 'maxTokens') {
    throw new TranslationFailed(`The translation into ${into.tag} ran on to the limit of ${tokenLimit} tokens`);
  }
  if (answer.stopReason !== 'eogToken' && answer.stopReason !== 'stopGenerationTrigger') {
    throw new TranslationFailed(`The translation into ${into.tag} stopped unexpectedly: ${answer.stopReason}`);
  }
  const translation = answer.text.trim();
  if (translation === '') throw new TranslationFailed(`The translation into ${into.tag} was empty`);
  return translation;
}

/** Tokens for the prompt and the translation together: room for a long utterance and its translation. */
const CONTEXT_SIZE = 4096;

type WorkerMessage =
  | { readonly type: 'ready'; readonly gpu: string | false }
  | ({ readonly type: 'answer'; readonly id: number } & ModelAnswer);

/**
 * Translates with Hy-MT2-1.8B, which node-llama-cpp runs in a worker thread
 * (llama-worker.mjs) on the Mac's GPU or on the CPU. It translates one text
 * at a time, in the order asked.
 */
export class HyMtTranslator implements TextTranslator {
  private readonly waiting = new Map<number, (answer: ModelAnswer) => void>();
  private nextId = 0;
  private stopped: string | undefined;

  private constructor(
    private readonly worker: Worker,
    /** Where the model runs: "metal" for the Mac's GPU, or false for the CPU. */
    readonly gpu: string | false
  ) {
    worker.on('message', (message: WorkerMessage) => {
      if (message.type !== 'answer') return;
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);
    });
    worker.on('error', (error) => this.stop(`it failed: ${error.message}`));
    worker.on('exit', (code) => this.stop(`it exited with code ${code}`));
  }

  /** Load the model from `modelsDir`, where `pnpm models:download` put it. */
  static async load(modelsDir: string): Promise<HyMtTranslator> {
    const worker = new Worker(path.join(__dirname, 'llama-worker.mjs'), {
      workerData: { modelPath: path.join(modelsDir, ...TRANSLATION_MODEL.model.path.split('/')), contextSize: CONTEXT_SIZE },
    });
    const ready = await new Promise<Extract<WorkerMessage, { type: 'ready' }>>((resolve, reject) => {
      // Only these listeners come off afterwards: the worker has listeners of its own.
      const done = () => {
        worker.off('message', onReady);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const onReady = (message: Extract<WorkerMessage, { type: 'ready' }>) => (done(), resolve(message));
      const onError = (error: Error) => (done(), reject(error));
      const onExit = (code: number) => (done(), reject(new Error(`The translation model exited with code ${code} while loading`)));
      worker.on('message', onReady);
      worker.on('error', onError);
      worker.on('exit', onExit);
    });
    return new HyMtTranslator(worker, ready.gpu);
  }

  async translate(text: string, into: LanguageCode): Promise<string> {
    const prompt = promptFor(text, into);
    const tokenLimit = tokenLimitFor(text);
    if (this.stopped !== undefined) throw new TranslationFailed(`The translation model has stopped: ${this.stopped}`);
    const id = this.nextId++;
    const answer = await new Promise<ModelAnswer>((resolve) => {
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, prompt, maxTokens: tokenLimit });
    });
    return translationFrom(answer, into, tokenLimit);
  }

  /** Stop the worker thread and free the model. */
  async close(): Promise<void> {
    await this.worker.terminate();
  }

  private stop(reason: string): void {
    this.stopped ??= reason;
    for (const answer of this.waiting.values()) answer({ error: `the translation model has stopped: ${reason}` });
    this.waiting.clear();
  }
}
