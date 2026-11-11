import { SpeechAudio } from '../../usecases/ports/speech-audio';

/** Discord sends voice as 48 kHz stereo, whatever the bot asks for. */
export const DISCORD_SAMPLE_RATE_HZ = 48_000;
export const DISCORD_CHANNELS = 2;

const BYTES_PER_SAMPLE = 2;
const FRAME_BYTES = DISCORD_CHANNELS * BYTES_PER_SAMPLE;
const STEP = DISCORD_SAMPLE_RATE_HZ / SpeechAudio.SAMPLE_RATE_HZ;

/**
 * Turn Discord's decoded voice, 16-bit little-endian PCM at 48 kHz in
 * stereo, into speech for the translator, 16 kHz mono.
 *
 * As the bot always has, it keeps every third frame, without filtering out
 * what 16 kHz cannot carry, and mixes each kept frame down to the average of
 * its two channels, rounded down. A trailing part of a frame is dropped.
 */
export function toSpeechAudio(discordPcm: Buffer): SpeechAudio {
  const sourceFrames = Math.floor(discordPcm.length / FRAME_BYTES);
  const frames = Math.floor(sourceFrames / STEP);
  const mono = Buffer.alloc(frames * BYTES_PER_SAMPLE);

  for (let i = 0; i < frames; i++) {
    const offset = i * STEP * FRAME_BYTES;
    const left = discordPcm.readInt16LE(offset);
    const right = discordPcm.readInt16LE(offset + BYTES_PER_SAMPLE);
    mono.writeInt16LE(Math.floor((left + right) / 2), i * BYTES_PER_SAMPLE);
  }
  return SpeechAudio.fromPcm(mono);
}
