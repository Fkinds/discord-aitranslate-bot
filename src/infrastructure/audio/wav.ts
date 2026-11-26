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

/**
 * The speech in a WAVE file of linear PCM, 16-bit, mono, at 16 kHz, as toWav
 * writes it, skipping any chunk but "fmt " and "data".
 *
 * @throws RangeError for any other file.
 */
export function fromWav(wav: Buffer): SpeechAudio {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new RangeError('Not a WAVE file');
  }
  let format: string | undefined;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = [wav.readUInt16LE(body), wav.readUInt16LE(body + 2), wav.readUInt32LE(body + 4), wav.readUInt16LE(body + 14)].join(',');
    }
    if (id === 'data') {
      const expected = [PCM_FORMAT, SpeechAudio.CHANNELS, SpeechAudio.SAMPLE_RATE_HZ, SpeechAudio.BITS_PER_SAMPLE].join(',');
      if (format !== expected) {
        throw new RangeError(`Expected 16-bit mono linear PCM at 16 kHz (format, channels, rate, bits ${expected}), got ${format}`);
      }
      return SpeechAudio.fromPcm(wav.subarray(body, body + size));
    }
    offset = body + size + (size % 2);
  }
  throw new RangeError('No data chunk in the WAVE file');
}
