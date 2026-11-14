// @ts-check
// Runs the translation model with node-llama-cpp, in a child process of its
// own. node-llama-cpp is an ES module with top-level await: this CommonJS
// project cannot require() it, and Jest cannot import() it. A child process
// loads it with Node's own loader, in the bot and in the tests alike, and
// shares no native state with the speech recognizer (onnxruntime), which made
// the model write garbage now and then on an Intel Xeon 6975P-C.
// HyMtTranslator (hy-mt-translator.ts) starts it with its settings as the
// argument, and sends it the prompts over the IPC channel.
import { getLlama, LlamaChatSession, LlamaLogLevel } from 'node-llama-cpp';

if (!process.send) throw new Error('llama-worker.mjs runs only as a child process with an IPC channel');
const send = process.send.bind(process);

/** @type {{ modelPath: string, contextSize: number }} */
const { modelPath, contextSize } = JSON.parse(process.argv[2] ?? '{}');

// End with the bot, however the bot ended.
process.on('disconnect', () => process.exit(0));

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
  process.on('message', (/** @type {Request} */ request) => {
    previous = previous.then(() => answer(session, request));
  });
  send({ type: 'ready', gpu: llama.gpu });
}

/**
 * @param {LlamaChatSession} session
 * @param {Request} request
 */
async function answer(session, { id, prompt, maxTokens }) {
  try {
    // Each prompt on its own, with no system prompt, as the model card asks.
    session.setChatHistory([]);
    // Evaluated from the start every time: reusing what an earlier prompt left
    // in the context changes how the tokens are batched, and on the CPU that
    // can change which token is likeliest, and so the translation.
    await session.sequence.clearHistory();
    const { responseText, stopReason } = await session.promptWithMeta(prompt, {
      maxTokens,
      // Always the likeliest token, so that the same text gets the same
      // translation; with the repeat penalty the model card recommends.
      temperature: 0,
      repeatPenalty: { penalty: 1.05 },
    });
    send({ type: 'answer', id, text: responseText, stopReason });
  } catch (error) {
    send({ type: 'answer', id, error: error instanceof Error ? error.message : String(error) });
  }
}

start().catch((error) => {
  // Tell HyMtTranslator why, then end.
  send({ type: 'failed', error: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
});
