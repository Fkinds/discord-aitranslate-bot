import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import type { Logger } from '../../usecases/ports/logger';
import type { ModelFile } from './model-files';

/** A model file could not be downloaded, or what came was not the file. */
export class ModelDownloadFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface DownloadOptions {
  readonly logger: Logger;
  /** Give up on a file when no bytes of it arrive for this long. */
  readonly idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * Download each file into `dir`, one after another. A file already there with
 * the expected size and SHA-256 is kept; any other is downloaded again. Each
 * download is written beside its file and moved into place only once its size
 * and SHA-256 match, so an interrupted run never leaves a broken file behind.
 * Running it again picks up where it stopped.
 *
 * @throws ModelDownloadFailed at the first file that could not be downloaded.
 */
export async function downloadModels(files: readonly ModelFile[], dir: string, options: DownloadOptions): Promise<void> {
  for (const file of files) {
    const target = path.join(dir, ...file.path.split('/'));
    if (await isIntact(target, file)) {
      options.logger.info(`${file.path} is already there`);
      continue;
    }
    options.logger.info(`Downloading ${file.path} (${megabytes(file.bytes)} MB)`);
    await download(file, target, options);
    options.logger.info(`Downloaded ${file.path}`);
  }
}

async function isIntact(target: string, file: ModelFile): Promise<boolean> {
  const size = await stat(target).then(
    (stats) => (stats.isFile() ? stats.size : undefined),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  );
  if (size !== file.bytes) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer);
  return hash.digest('hex') === file.sha256;
}

async function download(file: ModelFile, target: string, options: DownloadOptions): Promise<void> {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const partial = `${target}.part`;
  const abort = new AbortController();
  let idle: NodeJS.Timeout | undefined;
  const awaitBytes = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => abort.abort(new ModelDownloadFailed(`${file.path}: no data from ${file.url} for ${idleTimeoutMs} ms`)),
      idleTimeoutMs
    );
  };

  try {
    await mkdir(path.dirname(target), { recursive: true });
    awaitBytes();
    const response = await fetch(file.url, { signal: abort.signal });
    if (!response.ok || !response.body) {
      throw new ModelDownloadFailed(`${file.path}: ${file.url} answered HTTP ${response.status}`);
    }

    const hash = createHash('sha256');
    let received = 0;
    let reported = 0;
    const check = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        awaitBytes();
        received += chunk.length;
        if (received > file.bytes) {
          done(new ModelDownloadFailed(`${file.path}: ${file.url} sent more than the ${file.bytes} bytes expected`));
          return;
        }
        hash.update(chunk);
        const tenths = Math.floor((received * 10) / file.bytes);
        if (tenths > reported && tenths < 10) {
          reported = tenths;
          options.logger.info(`Downloading ${file.path}: ${tenths * 10}%`);
        }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), check, createWriteStream(partial));

    if (received !== file.bytes) {
      throw new ModelDownloadFailed(`${file.path}: ${file.url} sent ${received} bytes, not the ${file.bytes} expected`);
    }
    const sha256 = hash.digest('hex');
    if (sha256 !== file.sha256) {
      throw new ModelDownloadFailed(`${file.path}: the SHA-256 of what ${file.url} sent is ${sha256}, not ${file.sha256}`);
    }
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    if (error instanceof ModelDownloadFailed) throw error;
    const reason = abort.signal.reason instanceof ModelDownloadFailed ? abort.signal.reason : undefined;
    if (reason) throw reason;
    throw new ModelDownloadFailed(`${file.path}: downloading ${file.url} failed: ${String(error)}`, { cause: error });
  } finally {
    clearTimeout(idle);
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}
