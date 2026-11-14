// @ts-check
// Runs the translation model with node-llama-cpp, in a worker thread of its own.
// node-llama-cpp is an ES module with top-level await: this CommonJS project
// cannot require() it, and Jest cannot import() it. A worker thread loads it
// with Node's own loader, in the bot and in the tests alike. HyMtTranslator
// (hy-mt-translator.ts) starts it and sends it the prompts.
import { parentPort, workerData } from 'node:worker_threads';
import { getLlama, LlamaChatSession, LlamaLogLevel } from 'node-llama-cpp';

if (!parentPort) throw new Error('llama-worker.mjs runs only as a worker thread');
const port = parentPort;

/** @type {{ modelPath: string, contextSize: number }} */
const { modelPath, contextSize } = workerData;

/** @typedef {{ id: number, prompt: string, maxTokens: number }} Request */

/** Load the model, then answer each prompt sent, one at a time, as they share the one chat session. */
async function start() {
  // Never build llama.cpp from source here: use the prebuilt binary, for the
  // Mac's GPU (Metal) or the CPU, or fail.
  const llama = await getLlama({ build: 'never', logLevel: LlamaLogLevel.error });
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize });
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });

  let previous = Promise.resolve();
  port.on('message', (/** @type {Request} */ request) => {
    previous = previous.then(() => answer(session, request));
  });
  port.postMessage({ type: 'ready', gpu: llama.gpu });
}

/**
 * @param {LlamaChatSession} session
 * @param {Request} request
 */
async function answer(session, { id, prompt, maxTokens }) {
  try {
    // Each prompt on its own, with no system prompt, as the model card asks.
    session.setChatHistory([]);
    const { responseText, stopReason } = await session.promptWithMeta(prompt, {
      maxTokens,
      // Always the likeliest token, so that the same text gets the same
      // translation; with the repeat penalty the model card recommends.
      temperature: 0,
      repeatPenalty: { penalty: 1.05 },
    });
    port.postMessage({ type: 'answer', id, text: responseText, stopReason });
  } catch (error) {
    port.postMessage({ type: 'answer', id, error: error instanceof Error ? error.message : String(error) });
  }
}

start().catch((error) => {
  // Thrown outside the promise, so that the worker fails with it and
  // HyMtTranslator hears of it while it waits for the model to load.
  setImmediate(() => {
    throw error;
  });
});
