import { describe, it, expect, beforeEach } from '@jest/globals';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { createLogger } from '../../../src/infrastructure/winston-logger';

describe('createLogger', () => {
  let stream: PassThrough;
  let lines: string[];

  beforeEach(() => {
    stream = new PassThrough();
    lines = [];
    stream.on('data', (chunk: Buffer) => lines.push(stripVTControlCharacters(chunk.toString()).trimEnd()));
  });

  it('writes the time, the level and the message', () => {
    createLogger('info', stream).info('Logged in');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[info\]: Logged in$/);
  });

  it('writes the metadata as JSON', () => {
    createLogger('info', stream).warn('Retrying', { attempt: 1, guildId: '1' });

    expect(lines[0]).toMatch(/\[warn\]: Retrying \{"attempt":1,"guildId":"1"\}$/);
  });

  it('writes an error with its message and cause', () => {
    const error = new Error('quota exceeded', { cause: new Error('429') });

    createLogger('info', stream).error('Translation failed', { error });

    const json = JSON.parse(lines[0]!.replace(/^.*?Translation failed /, ''));
    expect(json.error).toMatchObject({ name: 'Error', message: 'quota exceeded', cause: { message: '429' } });
    expect(json.error.stack).toContain('quota exceeded');
  });

  it('leaves out entries below its level', () => {
    const logger = createLogger('warn', stream);

    logger.info('not written');
    logger.debug('not written');
    logger.error('written');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[error]: written');
  });
});
