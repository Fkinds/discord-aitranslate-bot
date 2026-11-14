import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadModels, ModelDownloadFailed } from '../../../../src/infrastructure/local/model-download';
import type { ModelFile } from '../../../../src/infrastructure/local/model-files';
import { FakeLogger } from '../../../support/fakes/fake-logger';
import { HttpStub } from '../../../support/http-stub';

const WEIGHTS = Buffer.from('the weights of a model, as its source publishes them');
const TOKENS = Buffer.from('the tokens of a model');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// The downloader against a model source on localhost, writing into a temporary directory.
describe('downloadModels', () => {
  let source: HttpStub;
  let dir: string;
  let logger: FakeLogger;

  /** A model file with these contents, served by the stub under `name`. */
  const fileOf = (name: string, contents: Buffer): ModelFile => ({
    path: `model/${name}`,
    url: `${source.url}/${name}`,
    bytes: contents.length,
    sha256: sha256(contents),
  });
  const download = (files: ModelFile[], idleTimeoutMs?: number) => downloadModels(files, dir, { logger, idleTimeoutMs });
  const placed = (name: string) => readFile(path.join(dir, 'model', name));
  const putInPlace = async (name: string, contents: Buffer) => {
    await mkdir(path.join(dir, 'model'), { recursive: true });
    await writeFile(path.join(dir, 'model', name), contents);
  };

  beforeEach(async () => {
    source = await HttpStub.start();
    dir = await mkdtemp(path.join(tmpdir(), 'models-'));
    logger = new FakeLogger();
  });

  afterEach(async () => {
    await source.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('downloads each file to its path under the directory', async () => {
    source.respond({ status: 200, body: WEIGHTS }, { status: 200, body: TOKENS });

    await download([fileOf('weights.bin', WEIGHTS), fileOf('tokens.txt', TOKENS)]);

    expect(await placed('weights.bin')).toEqual(WEIGHTS);
    expect(await placed('tokens.txt')).toEqual(TOKENS);
    expect(source.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/weights.bin'],
      ['GET', '/tokens.txt'],
    ]);
    expect(logger.messages('info')).toContain('Downloaded model/tokens.txt');
  });

  it('keeps a file that is already there and intact, without downloading it again', async () => {
    await putInPlace('weights.bin', WEIGHTS);

    await download([fileOf('weights.bin', WEIGHTS)]);

    expect(source.requests).toEqual([]);
    expect(logger.messages('info')).toEqual(['model/weights.bin is already there']);
  });

  it.each([
    ['has other contents of the same size', Buffer.alloc(WEIGHTS.length)],
    ['was cut short', WEIGHTS.subarray(0, 10)],
  ])('downloads again a file that is there but %s', async (_case, contents) => {
    await putInPlace('weights.bin', contents);
    source.respond({ status: 200, body: WEIGHTS });

    await download([fileOf('weights.bin', WEIGHTS)]);

    expect(await placed('weights.bin')).toEqual(WEIGHTS);
  });

  it.each([
    ['other contents of the expected size', Buffer.alloc(WEIGHTS.length), /SHA-256/],
    ['fewer bytes than expected', WEIGHTS.subarray(0, 10), /sent 10 bytes/],
    ['more bytes than expected', Buffer.concat([WEIGHTS, WEIGHTS]), /more than the \d+ bytes/],
  ])('refuses %s, and leaves nothing behind', async (_case, sent, message) => {
    source.respond({ status: 200, body: sent });

    const downloading = download([fileOf('weights.bin', WEIGHTS)]);

    await expect(downloading).rejects.toThrow(ModelDownloadFailed);
    await expect(downloading).rejects.toThrow(message);
    expect(await readdir(path.join(dir, 'model'))).toEqual([]);
  });

  it('stops at an HTTP error, naming the status, before the files after it', async () => {
    source.respond({ status: 404, body: { error: 'Not Found' } });

    await expect(download([fileOf('weights.bin', WEIGHTS), fileOf('tokens.txt', TOKENS)])).rejects.toThrow(
      `model/weights.bin: ${source.url}/weights.bin answered HTTP 404`
    );
    expect(source.requests).toHaveLength(1);
    expect(await readdir(path.join(dir, 'model'))).toEqual([]);
  });

  it('gives up on a source that sends nothing for too long', async () => {
    source.respond({ status: 200, body: WEIGHTS, delayMs: 1_000 });

    await expect(download([fileOf('weights.bin', WEIGHTS)], 50)).rejects.toThrow(
      `model/weights.bin: no data from ${source.url}/weights.bin for 50 ms`
    );
  });
});
