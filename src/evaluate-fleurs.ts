import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import { toWav } from './infrastructure/audio/wav';
import {
  FLEURS_LANGUAGES,
  FLEURS_REVISION,
  fleursUrl,
  fleursUtterances,
  sampleOf,
  speechFromFloatWav,
} from './infrastructure/evaluation/fleurs';

/** How many utterances of different sentences to take of each language. */
const DEFAULT_COUNT = 100;
/** How many times to try to download an archive, going on from where the last try stopped. */
const DOWNLOAD_ATTEMPTS = 5;

const USAGE = `Usage: pnpm eval:fleurs <directory> [--count <n>]

Takes sentences read out in Japanese and Korean from the test split of FLEURS
(Google, CC BY 4.0, revision ${FLEURS_REVISION.slice(0, 7)}), for pnpm eval:speech: the
first ${DEFAULT_COUNT} utterances of different sentences of each language, or --count.
Downloads each language's transcript and audio archive (0.4 GB for Japanese,
0.2 GB for Korean), and writes into <directory>:
  ja/<id>.wav, ko/<id>.wav  each utterance as 16-bit mono at 16 kHz
  sentences.tsv             each sentence's language, text and WAVE file`;

/**
 * Download `url` into `file`. A download cut off is taken up again where it
 * stopped, with an HTTP range request (RFC 9110), up to DOWNLOAD_ATTEMPTS
 * tries in all: the archives are hundreds of megabytes, and the connection
 * to them was reset before the end in a trial.
 */
async function download(url: string, file: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const have = await stat(file).then(({ size }) => size, () => 0);
    try {
      const response = await fetch(url, have > 0 ? { headers: { Range: `bytes=${have}-` } } : {});
      if (response.status === 416) return; // Nothing is left to download.
      if (!(response.ok && response.body)) throw new Error(`Downloading ${url} failed: HTTP ${response.status}`);
      // A server that ignores the range sends the whole file again.
      const flags = response.status === 206 ? 'a' : 'w';
      await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), createWriteStream(file, { flags }));
      return;
    } catch (error) {
      if (attempt === DOWNLOAD_ATTEMPTS) throw error;
      console.log(`Downloading ${url} stopped (${error instanceof Error ? error.message : String(error)}); going on, try ${attempt + 1}`);
    }
  }
}

/** Extract `members` of the gzipped tar archive at `url` into `dir`, with the system's tar. */
async function extract(url: string, members: readonly string[], dir: string): Promise<void> {
  const archive = path.join(dir, 'archive.tar.gz');
  await download(url, archive);
  await promisify(execFile)('tar', ['-xzf', archive, '-C', dir, ...members], { maxBuffer: 16 * 1024 * 1024 });
}

async function takeFleurs(dir: string, count: number): Promise<void> {
  const lines = [
    `# FLEURS (Google, CC BY 4.0), test split, revision ${FLEURS_REVISION}: https://huggingface.co/datasets/google/fleurs`,
    `# The first ${count} utterances of different sentences of each language, for pnpm eval:speech.`,
  ];
  for (const { fleurs, tag } of FLEURS_LANGUAGES) {
    const transcript = await fetch(fleursUrl(`data/${fleurs}/test.tsv`));
    if (!transcript.ok) throw new Error(`Downloading the ${fleurs} transcript failed: HTTP ${transcript.status}`);
    const sample = sampleOf(fleursUtterances(await transcript.text()), count);
    console.log(`Taking ${sample.length} utterances in ${fleurs} from its audio archive`);

    const archive = await mkdtemp(path.join(tmpdir(), `fleurs-${fleurs}-`));
    try {
      await extract(
        fleursUrl(`data/${fleurs}/audio/test.tar.gz`),
        sample.map(({ file }) => `test/${file}`),
        archive
      );
      await mkdir(path.join(dir, tag), { recursive: true });
      for (const { id, file, text } of sample) {
        const speech = speechFromFloatWav(await readFile(path.join(archive, 'test', file)));
        await writeFile(path.join(dir, tag, `${id}.wav`), toWav(speech));
        lines.push(`${tag}\t${text}\t${tag}/${id}.wav`);
      }
    } finally {
      await rm(archive, { recursive: true, force: true });
    }
  }
  await writeFile(path.join(dir, 'sentences.tsv'), `${lines.join('\n')}\n`);
  console.log(`Wrote ${path.join(dir, 'sentences.tsv')}; measure with pnpm eval:speech ${dir} --recognizers whisper,sensevoice`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const countAt = args.indexOf('--count');
  const count = countAt < 0 ? DEFAULT_COUNT : Number(args[countAt + 1]);
  const dir = args.find((arg, i) => !arg.startsWith('--') && !(countAt >= 0 && i === countAt + 1));
  if (!dir || !Number.isInteger(count) || count < 1) {
    console.error(USAGE);
    process.exit(2);
  }
  await takeFleurs(path.resolve(dir), count);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
