import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { LanguageCode } from './domain/language-code';
import { fromWav } from './infrastructure/audio/wav';
import { readModelsConfig } from './infrastructure/config';
import { characterErrorRate, errorsIn, type Errors } from './infrastructure/evaluation/character-error-rate';
import { recordingIn, sentencesIn, takesOf, type Recording } from './infrastructure/evaluation/recordings';
import { languageByScript } from './infrastructure/local/language-by-script';
import { WhisperRecognizer } from './infrastructure/local/whisper-recognizer';
import { SpeechAudio } from './usecases/ports/speech-audio';

/** The CPU threads Whisper uses, as the bot does. */
const THREADS = 4;
/** A recording that starts this long after the one before it ended starts the next sentence. */
const DEFAULT_GAP_MS = 1_500;

const USAGE = `Usage: pnpm eval:speech <directory> [--gap-ms <ms>] [--pair <language>,<language>]

Measures how well Whisper hears the utterances recorded with RECORD_SPEECH_OF
and RECORDINGS_DIR, against what was read out. The directory holds the
recordings, and sentences.tsv: the sentences in the order they were read, one
a line, the language and the text separated by a tab ("ja<TAB>ちょっと待って").
Leave ${DEFAULT_GAP_MS / 1000} s or more between sentences as you read them.

The session's pair of languages is that of the sentences when they are in two,
or --pair, such as --pair ja,ko for sentences in Japanese alone.`;

/** How Whisper heard one sentence, one way. */
interface Hearing {
  readonly text: string;
  readonly language: string | null;
  readonly ms: number;
}

/** The ways of hearing each sentence that are compared. */
const WAYS = {
  pair: 'as the bot hears it: each utterance, between the two languages, corrected by the letters',
  any: 'as before #119: each utterance, among every language Whisper knows',
  whole: 'the sentence as one utterance, between the two languages, corrected by the letters',
} as const;
type Way = keyof typeof WAYS;

async function hear(
  recognizer: WhisperRecognizer,
  utterances: readonly SpeechAudio[],
  among: readonly LanguageCode[],
  byScript: boolean
): Promise<Hearing> {
  const started = performance.now();
  const parts = [];
  for (const audio of utterances) parts.push(await recognizer.recognize(audio, among));
  const ms = performance.now() - started;
  const heard = parts.filter((part) => part.text !== '');
  const text = heard.map((part) => part.text).join(' ');
  const longest = heard.reduce<(typeof heard)[number] | undefined>(
    (a, b) => (a === undefined || b.text.length > a.text.length ? b : a),
    undefined
  );
  const language = longest?.language ?? null;
  return { text, language: byScript ? languageByScript(text, language) : language, ms };
}

async function evaluate(dir: string, gapMs: number, pairTags: readonly string[] | undefined): Promise<void> {
  const sentences = sentencesIn(await readFile(path.join(dir, 'sentences.tsv'), 'utf8'));
  const recordings = (await readdir(dir))
    .map((name) => recordingIn(path.join(dir, name), name))
    .filter((recording): recording is Recording => recording !== undefined);
  const takes = takesOf(recordings, gapMs);
  if (takes.length !== sentences.length) {
    const durations = takes.map((take, i) => `${i + 1}: ${take.length} utterance(s), ${secondsOf(take).toFixed(1)} s`);
    throw new Error(
      `${sentences.length} sentences, but the recordings make ${takes.length} takes with --gap-ms ${gapMs}:\n  ${durations.join('\n  ')}`
    );
  }

  const tags = pairTags ?? [...new Set(sentences.map((sentence) => sentence.language))];
  const pair = tags.length === 2 ? tags.map((tag) => LanguageCode.of(tag)) : [];
  console.log(pair.length === 2 ? `Hearing between ${pair.join(' and ')}\n` : 'Hearing among every language: no pair\n');
  const config = readModelsConfig(process.env, process.cwd());
  const recognizer = await WhisperRecognizer.load(config.modelsDir, { threads: THREADS });

  const errors: Record<Way, Errors[]> = { pair: [], any: [], whole: [] };
  const rightLanguage: Record<Way, number> = { pair: 0, any: 0, whole: 0 };
  const ms: Record<Way, number> = { pair: 0, any: 0, whole: 0 };
  let utteranceCount = 0;
  let seconds = 0;

  console.log(`| # | Said | ${Object.keys(WAYS).join(' | ')} |\n|---|---|---|---|---|`);
  for (const [i, take] of takes.entries()) {
    const sentence = sentences[i]!;
    const utterances = await Promise.all(take.map(async ({ file }) => fromWav(await readFile(file))));
    const whole = SpeechAudio.fromPcm(Buffer.concat(utterances.map((audio) => audio.pcm)));
    const heard: Record<Way, Hearing> = {
      pair: await hear(recognizer, utterances, pair, true),
      any: await hear(recognizer, utterances, [], false),
      whole: await hear(recognizer, [whole], pair, true),
    };
    utteranceCount += utterances.length;
    seconds += whole.pcm.byteLength / 2 / SpeechAudio.SAMPLE_RATE_HZ;
    for (const way of Object.keys(WAYS) as Way[]) {
      errors[way].push(errorsIn(sentence.text, heard[way].text));
      if (heard[way].language === sentence.language) rightLanguage[way]++;
      ms[way] += heard[way].ms;
    }
    console.log(`| ${i + 1} | ${cell(sentence)} | ${(Object.keys(WAYS) as Way[]).map((way) => cell(heard[way])).join(' | ')} |`);
  }

  console.log(`\n${sentences.length} sentences, ${utteranceCount} utterances, ${seconds.toFixed(1)} s of speech\n`);
  console.log('| Way | Character error rate | Right language | Time a second of speech |\n|---|---|---|---|');
  for (const way of Object.keys(WAYS) as Way[]) {
    const rate = (characterErrorRate(errors[way]) * 100).toFixed(1);
    const right = `${rightLanguage[way]}/${sentences.length}`;
    console.log(`| ${way}: ${WAYS[way]} | ${rate}% | ${right} | ${(ms[way] / seconds).toFixed(0)} ms |`);
  }
}

function secondsOf(take: readonly Recording[]): number {
  return (take.at(-1)!.endedAt.getTime() - take[0]!.startedAt.getTime()) / 1000;
}

/** A table cell: the text, with its language. */
function cell({ text, language }: { text: string; language: string | null }): string {
  return `${text.replace(/\|/g, '\\|') || '—'} [${language ?? '?'}]`;
}

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const gapMs = Number(valueOf('--gap-ms') ?? DEFAULT_GAP_MS);
  const pair = valueOf('--pair')?.split(',');
  const values = new Set(['--gap-ms', '--pair'].map((flag) => args.indexOf(flag) + 1).filter((i) => i > 0));
  const dir = args.find((arg, i) => !arg.startsWith('--') && !values.has(i));
  if (!dir || !Number.isFinite(gapMs) || (pair !== undefined && pair.length !== 2)) {
    console.error(USAGE);
    process.exit(2);
  }
  await evaluate(path.resolve(dir), gapMs, pair);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
