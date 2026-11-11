import { describe, it, expect, beforeEach } from '@jest/globals';
import { OpusEncoder } from '@discordjs/opus';
import { type OpusDecoder, recordUtterance } from '../../../../src/infrastructure/discord/record-utterance';
import { FakeLogger } from '../../../support/fakes/fake-logger';

async function* packetsOf(...packets: Buffer[]): AsyncGenerator<Buffer> {
  yield* packets;
}

/** Decodes a packet [n] into three stereo frames whose channels are n, so that each packet becomes one sample. */
const fakeDecoder: OpusDecoder = {
  decode(packet) {
    if (packet[0] === 0xff) throw new Error('corrupted packet');
    const pcm = Buffer.alloc(12);
    for (let offset = 0; offset < 12; offset += 2) pcm.writeInt16LE(packet[0]!, offset);
    return pcm;
  },
};

describe('recordUtterance', () => {
  let logger: FakeLogger;

  beforeEach(() => {
    logger = new FakeLogger();
  });

  it('decodes every packet and turns them into speech, in order', async () => {
    const speech = await recordUtterance(packetsOf(Buffer.from([1]), Buffer.from([2])), fakeDecoder, logger);

    expect([...speech.pcm]).toEqual([1, 0, 2, 0]);
  });

  it('skips a packet that cannot be decoded, and logs it', async () => {
    const speech = await recordUtterance(packetsOf(Buffer.from([1]), Buffer.from([0xff]), Buffer.from([3])), fakeDecoder, logger);

    expect([...speech.pcm]).toEqual([1, 0, 3, 0]);
    expect(logger.messages('error')).toEqual(['Failed to decode an Opus packet; skipping it']);
  });

  it('is empty speech when nothing was received', async () => {
    expect((await recordUtterance(packetsOf(), fakeDecoder, logger)).isEmpty).toBe(true);
  });

  it('fails when the stream fails', async () => {
    async function* failing(): AsyncGenerator<Buffer> {
      yield Buffer.from([1]);
      throw new Error('stream destroyed');
    }

    await expect(recordUtterance(failing(), fakeDecoder, logger)).rejects.toThrow('stream destroyed');
  });

  it('decodes real Opus packets of 20 ms into 20 ms of 16 kHz speech each', async () => {
    const opus = new OpusEncoder(48_000, 2);
    const twentyMs = Buffer.alloc(960 * 4);
    const packets = [opus.encode(twentyMs), opus.encode(twentyMs)];

    const speech = await recordUtterance(packetsOf(...packets), new OpusEncoder(48_000, 2), logger);

    expect(speech.pcm.byteLength).toBe(2 * 320 * 2);
  });
});
