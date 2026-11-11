import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { toSpeechAudio } from './speech-conversion';

/** Decodes Opus packets to 16-bit PCM, as @discordjs/opus's OpusEncoder does. */
export interface OpusDecoder {
  decode(packet: Buffer): Buffer;
}

/**
 * Collect an utterance's Opus packets until the stream ends, then turn them
 * into speech for the translator.
 *
 * A packet that cannot be decoded is logged and skipped, as the bot always
 * has. An utterance with no decodable packets is empty speech.
 *
 * @param decoder one decoder for the whole utterance, since Opus decoding
 *   carries state from one packet to the next.
 * @throws whatever the stream fails with.
 */
export async function recordUtterance(
  packets: AsyncIterable<Buffer>,
  decoder: OpusDecoder,
  logger: Logger
): Promise<SpeechAudio> {
  const pcm: Buffer[] = [];
  for await (const packet of packets) {
    try {
      pcm.push(decoder.decode(packet));
    } catch (error) {
      logger.error('Failed to decode an Opus packet; skipping it', { bytes: packet.length, error });
    }
  }
  return toSpeechAudio(Buffer.concat(pcm));
}
