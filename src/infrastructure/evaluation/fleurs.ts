import { SpeechAudio } from '../../usecases/ports/speech-audio';

/**
 * FLEURS (Google, CC BY 4.0): sentences of Wikipedia read out in 102
 * languages, at a fixed revision of https://huggingface.co/datasets/google/fleurs.
 */
export const FLEURS_REVISION = '70bb2e84b976b7e960aa89f1c648e09c59f894dd';

/** The languages taken from FLEURS: its name for each, and the language tag the bot names it by. */
export const FLEURS_LANGUAGES = [
  { fleurs: 'ja_jp', tag: 'ja' },
  { fleurs: 'ko_kr', tag: 'ko' },
] as const;

/** Where a file of FLEURS is, such as "data/ja_jp/test.tsv". */
export function fleursUrl(file: string): string {
  return `https://huggingface.co/datasets/google/fleurs/resolve/${FLEURS_REVISION}/${file}`;
}

/** An utterance of FLEURS: a sentence, by its id, read out in a WAVE file. */
export interface FleursUtterance {
  /** The sentence's id; the same sentence is read out by several speakers. */
  readonly id: string;
  /** The WAVE file's name in the audio archive, under "test/". */
  readonly file: string;
  /** What was read out, as written. */
  readonly text: string;
}

/**
 * The utterances of a FLEURS transcript, such as data/ja_jp/test.tsv: no
 * header, one a line, tab-separated: the id, the file name, the
 * transcription as written, then others. A transcription that holds quotes
 * is written as CSV writes it, in quotes with each quote doubled; it is read
 * as it was written.
 *
 * @throws RangeError for a line of fewer than three columns.
 */
export function fleursUtterances(tsv: string): FleursUtterance[] {
  return tsv
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      const [id, file, text] = line.split('\t');
      if (id === undefined || file === undefined || text === undefined) {
        throw new RangeError(`Line ${index + 1} of the FLEURS transcript has fewer than three columns`);
      }
      return { id, file, text: unquoted(text) };
    });
}

/** The first `count` utterances of different sentences, in the order they come. */
export function sampleOf(utterances: readonly FleursUtterance[], count: number): FleursUtterance[] {
  const seen = new Set<string>();
  const sample: FleursUtterance[] = [];
  for (const utterance of utterances) {
    if (sample.length === count) break;
    if (seen.has(utterance.id)) continue;
    seen.add(utterance.id);
    sample.push(utterance);
  }
  return sample;
}

function unquoted(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/""/g, '"') : text;
}

const FLOAT_FORMAT = 3;

/**
 * The speech in a WAVE file of FLEURS, which holds 32-bit floating-point
 * samples (IEEE 754), mono, at 16 kHz, as the 16-bit samples the bot hears,
 * rounded, and clipped to the 16-bit range.
 *
 * @throws RangeError when the file is not a WAVE file of that format.
 */
export function speechFromFloatWav(wav: Buffer): SpeechAudio {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new RangeError('Not a WAVE file');
  let format: string | undefined;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = [wav.readUInt16LE(body), wav.readUInt16LE(body + 2), wav.readUInt32LE(body + 4), wav.readUInt16LE(body + 14)].join(',');
    }
    if (id === 'data') {
      const expected = [FLOAT_FORMAT, 1, SpeechAudio.SAMPLE_RATE_HZ, 32].join(',');
      if (format !== expected) {
        throw new RangeError(`Expected 32-bit float mono at 16 kHz (format, channels, rate, bits ${expected}), got ${format}`);
      }
      const samples = Math.min(size, wav.length - body) / 4;
      const pcm = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++) {
        const value = Math.round(wav.readFloatLE(body + i * 4) * 32_767);
        pcm.writeInt16LE(Math.max(-32_768, Math.min(32_767, value)), i * 2);
      }
      return SpeechAudio.fromPcm(pcm);
    }
    offset = body + size + (size % 2);
  }
  throw new RangeError('No data chunk in the WAVE file');
}
