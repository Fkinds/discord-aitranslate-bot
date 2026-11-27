import { describe, it, expect, afterEach } from '@jest/globals';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GuildId, UserId } from '../../../../src/domain/discord-ids';
import type { VoiceListener } from '../../../../src/infrastructure/discord/discord-voice';
import { RecordingVoiceListener, writeMakingDirectories } from '../../../../src/infrastructure/discord/speech-recorder';
import { SpeechAudio } from '../../../../src/usecases/ports/speech-audio';
import { deferred } from '../../../support/deferred';
import { FakeLogger } from '../../../support/fakes/fake-logger';

const ignore: VoiceListener = {
  speakingStarted: () => {},
  speakingStopped: () => {},
  utteranceStarted: () => {},
  moved: () => {},
  connectionLost: () => {},
  connectionBack: () => {},
  disconnected: () => {},
};

// The recordings on this machine's disk, in a directory of the test's own.
describe('RecordingVoiceListener, writing files', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('writes the WAVE file, making the directory it goes in', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'recordings-'));
    const dir = path.join(root, 'ja');
    const speech = SpeechAudio.fromPcm(new Uint8Array([1, 0, 2, 0]));
    // The listener records without being awaited: the test waits for the file to be written, however long that takes.
    const written = deferred<void>();
    const write = (file: string, bytes: Buffer) => writeMakingDirectories(file, bytes).then(written.resolve, written.reject);
    const listener = new RecordingVoiceListener(ignore, UserId.of('30'), dir, () => new Date('2026-11-26T14:25:00Z'), new FakeLogger(), write);

    listener.utteranceStarted(GuildId.of('1'), UserId.of('30'), Promise.resolve(speech));
    await written.promise;

    const [name] = await readdir(dir);
    expect(name).toBe('20261126T142500.000Z-20261126T142500.000Z.wav');
    const wav = await readFile(path.join(dir, name!));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect([...wav.subarray(44)]).toEqual([1, 0, 2, 0]);
  });
});
