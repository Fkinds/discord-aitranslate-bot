import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
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

/** What the model's process answers to a prompt. */
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
  | { readonly type: 'failed'; readonly error: string }
  | ({ readonly type: 'answer'; readonly id: number } & ModelAnswer);

/**
 * Translates with Hy-MT2-1.8B, which node-llama-cpp runs in a child process
 * of its own (llama-worker.mjs) on the Mac's GPU or on the CPU. It translates
 * one text at a time, in the order asked.
 *
 * A process, not a worker thread: in the process that recognizes speech with
 * onnxruntime, the model wrote garbage now and then on an Intel Xeon 6975P-C
 * (5 of 8 runs in CI), and never in a process of its own.
 */
export class HyMtTranslator implements TextTranslator {
  private readonly waiting = new Map<number, (answer: ModelAnswer) => void>();
  private nextId = 0;
  private stopped: string | undefined;

  private constructor(
    private readonly worker: ChildProcess,
    /** Where the model runs: "metal" for the Mac's GPU, or false for the CPU. */
    readonly gpu: string | false
  ) {
    worker.on('message', (message: WorkerMessage) => {
      if (message.type !== 'answer') return;
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);
      if (this.waiting.size === 0) keepRunning(worker, false);
    });
    worker.on('error', (error) => this.stop(`it failed: ${error.message}`));
    worker.on('exit', (code, signal) => this.stop(`it exited with ${signal ?? `code ${code}`}`));
    // The model keeps the bot's process running only while a translation is
    // awaited (translate() turns it on); otherwise the connection to Discord does.
    keepRunning(worker, false);
  }

  /** Load the model from `modelsDir`, where `pnpm models:download` put it. */
  static async load(modelsDir: string): Promise<HyMtTranslator> {
    const settings = { modelPath: path.join(modelsDir, ...TRANSLATION_MODEL.model.path.split('/')), contextSize: CONTEXT_SIZE };
    // Without the Node.js options of this process, such as the bot's heap limit.
    const worker = fork(path.join(__dirname, 'llama-worker.mjs'), [JSON.stringify(settings)], { execArgv: [] });
    const ready = await new Promise<Extract<WorkerMessage, { type: 'ready' }>>((resolve, reject) => {
      const done = () => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const onMessage = (message: WorkerMessage) => {
        if (message.type === 'ready') {
          done();
          resolve(message);
        } else if (message.type === 'failed') {
          done();
          worker.kill();
          reject(new Error(`The translation model failed to load: ${message.error}`));
        }
      };
      const onError = (error: Error) => (done(), reject(error));
      const onExit = (code: number | null, signal: string | null) => {
        done();
        reject(new Error(`The translation model exited with ${signal ?? `code ${code}`} while loading`));
      };
      worker.on('message', onMessage);
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
      keepRunning(this.worker, true);
      this.worker.send({ id, prompt, maxTokens: tokenLimit }, (error) => {
        if (error) this.stop(`sending it the text failed: ${error.message}`);
      });
    });
    return translationFrom(answer, into, tokenLimit);
  }

  /** Stop the model's process, and so free the model. */
  async close(): Promise<void> {
    if (this.worker.exitCode !== null || this.worker.signalCode !== null) return;
    const exited = once(this.worker, 'exit');
    this.worker.kill();
    await exited;
  }

  private stop(reason: string): void {
    this.stopped ??= reason;
    for (const answer of this.waiting.values()) answer({ error: `the translation model has stopped: ${reason}` });
    this.waiting.clear();
  }
}

/** Whether the child process, and the channel to it, keep this process running. */
function keepRunning(child: ChildProcess, keep: boolean): void {
  if (keep) {
    child.ref();
    child.channel?.ref();
  } else {
    child.unref();
    child.channel?.unref();
  }
}
