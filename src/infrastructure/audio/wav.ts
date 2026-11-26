import { SpeechAudio } from '../../usecases/ports/speech-audio';

const HEADER_BYTES = 44;
const PCM_FORMAT = 1;

/**
 * Wrap the speech in a WAVE file: a RIFF header with a "fmt " chunk for
 * linear PCM, then a "data" chunk with the samples. Gemini takes audio as a
 * file, not as raw samples.
 */
export function toWav(audio: SpeechAudio): Buffer {
  const { SAMPLE_RATE_HZ: sampleRate, CHANNELS: channels, BITS_PER_SAMPLE: bitsPerSample } = SpeechAudio;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = audio.pcm.byteLength;

  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(HEADER_BYTES - 8 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(PCM_FORMAT, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);

  return Buffer.concat([header, audio.pcm]);
}
