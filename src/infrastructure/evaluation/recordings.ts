/** A recorded utterance, by its file, and when it started and ended. */
export interface Recording {
  readonly file: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/** A sentence that was read out, in the language it is in, such as "ja". */
export interface Sentence {
  readonly language: string;
  readonly text: string;
  /** The WAVE file it was read out in, from a dataset, relative to the list; none when it was recorded. */
  readonly audio?: string;
}

const TIME = '(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})\\.(\\d{3})Z';
const NAME = new RegExp(`^${TIME}-${TIME}\\.wav$`);

/**
 * The recording a file is, by its name, as RecordingVoiceListener names it:
 * "20261126T142500.123Z-20261126T142502.456Z.wav". Undefined for any other name.
 */
export function recordingIn(file: string, name: string): Recording | undefined {
  const match = NAME.exec(name);
  if (!match) return undefined;
  const at = (parts: string[]) => {
    const [year, month, day, hours, minutes, seconds, ms] = parts.map(Number) as [number, number, number, number, number, number, number];
    return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
  };
  return { file, startedAt: at(match.slice(1, 8)), endedAt: at(match.slice(8, 15)) };
}

/**
 * The recordings in the takes of one sentence each, in the order they were
 * made: one recording starts a new take when it starts `gapMs` or more after
 * the one before it ended. A sentence may be cut into several utterances by
 * pauses within it, which are shorter.
 */
export function takesOf(recordings: readonly Recording[], gapMs: number): Recording[][] {
  const takes: Recording[][] = [];
  const sorted = [...recordings].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (const recording of sorted) {
    const take = takes.at(-1);
    const last = take?.at(-1);
    if (take && last && recording.startedAt.getTime() - last.endedAt.getTime() < gapMs) take.push(recording);
    else takes.push([recording]);
  }
  return takes;
}

/**
 * The sentences in a list of them, one a line, its language and its text
 * separated by a tab: "ja\tちょっと待って", and, from a dataset, the WAVE
 * file it was read out in, after another tab. Blank lines and lines starting
 * with "#" are skipped.
 *
 * @throws RangeError for a line with no tab, or more than two.
 */
export function sentencesIn(list: string): Sentence[] {
  return list
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line, index) => {
      const [language, text, audio, ...more] = line.split('\t').map((column) => column.trim());
      if (text === undefined) throw new RangeError(`Sentence ${index + 1} has no tab between its language and its text: ${line}`);
      if (more.length > 0) throw new RangeError(`Sentence ${index + 1} has more than three columns: ${line}`);
      return { language: language!, text, ...(audio ? { audio } : {}) };
    });
}
