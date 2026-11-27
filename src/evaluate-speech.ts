import { fork } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { LanguageCode } from './domain/language-code';
import { fromWav } from './infrastructure/audio/wav';
import { readModelsConfig } from './infrastructure/config';
import { recordingIn, sentencesIn, takesOf, type Recording, type Sentence } from './infrastructure/evaluation/recordings';
import { type Hearing, summariesOf } from './infrastructure/evaluation/speech-summary';
import { languageByScript } from './infrastructure/local/language-by-script';
import { SenseVoiceRecognizer } from './infrastructure/local/sensevoice-recognizer';
import { type SpeechRecognizer, WhisperRecognizer } from './infrastructure/local/whisper-recognizer';
import { SpeechAudio } from './usecases/ports/speech-audio';

/** The CPU threads each recognizer uses, as the bot gives Whisper. */
const THREADS = 4;
/** A recording that starts this long after the one before it ended starts the next sentence. */
const DEFAULT_GAP_MS = 1_500;

/** The recognizers that can be compared, by the name to give them. */
const RECOGNIZERS: Record<string, (modelsDir: string) => Promise<SpeechRecognizer>> = {
  whisper: (modelsDir) => WhisperRecognizer.load(modelsDir, { threads: THREADS }),
  sensevoice: (modelsDir) => SenseVoiceRecognizer.load(modelsDir, { threads: THREADS }),
};

const USAGE = `Usage: pnpm eval:speech <directory> [--recognizers <name>,<name>,...] [--gap-ms <ms>] [--pair <language>,<language>]

Measures how well each recognizer hears the sentences of <directory>/sentences.tsv,
one a line, the language and the text separated by a tab ("ja<TAB>ちょっと待って"):
  - from a dataset, each sentence has the WAVE file it was read out in after
    another tab, relative to the directory (pnpm eval:fleurs makes one);
  - otherwise, the directory holds the utterances recorded with RECORD_SPEECH_OF
    and RECORDINGS_DIR, read in the order of the list, leaving ${DEFAULT_GAP_MS / 1000} s or more
    between sentences.

Recognizers: ${Object.keys(RECOGNIZERS).join(', ')}; whisper, the bot's, by default. sensevoice
needs pnpm models:download --candidates. Each runs in a process of its own, so
that the memory it takes is measured alone.

The session's pair of languages is that of the sentences when they are in two,
or --pair, such as --pair ja,ko for sentences in Japanese alone.

Writes speech-results.md in the directory: each sentence as each recognizer
heard it, and how well each heard each language, which it also prints.`;

/** The ways of hearing each sentence that are compared. Of a dataset, each sentence is one utterance, heard as the bot hears it. */
const WAYS = {
  pair: 'as the bot hears it: each utterance, between the two languages, corrected by the letters',
  any: 'as before #119: each utterance, among every language the recognizer knows',
  whole: 'the sentence as one utterance, between the two languages, corrected by the letters',
} as const;
type Way = keyof typeof WAYS;

/** The sentences, each with the utterances it was said in, and the ways to hear them. */
interface Material {
  readonly sentences: readonly Sentence[];
  readonly utterances: readonly (readonly SpeechAudio[])[];
  readonly ways: readonly Way[];
}

/** What a recognizer's process tells its parent. */
interface Report {
  readonly hearings: Partial<Record<Way, Hearing[]>>;
  /** The most memory its process took, in bytes. */
  readonly maxRssBytes: number;
}

async function materialIn(dir: string, gapMs: number): Promise<Material> {
  const sentences = sentencesIn(await readFile(path.join(dir, 'sentences.tsv'), 'utf8'));
  const fromDataset = sentences.filter((sentence) => sentence.audio !== undefined).length;
  if (fromDataset === sentences.length) {
    const utterances = await Promise.all(sentences.map(async ({ audio }) => [fromWav(await readFile(path.join(dir, audio!)))]));
    return { sentences, utterances, ways: ['pair'] };
  }
  if (fromDataset > 0) throw new Error(`${fromDataset} of the ${sentences.length} sentences have a WAVE file: give all of them one, or none`);

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
  const utterances = await Promise.all(takes.map((take) => Promise.all(take.map(async ({ file }) => fromWav(await readFile(file))))));
  return { sentences, utterances, ways: ['pair', 'any', 'whole'] };
}

/** Hear the sentences with one recognizer, each of the ways. */
async function hearAll(recognizer: SpeechRecognizer, material: Material, pair: readonly LanguageCode[]): Promise<Report['hearings']> {
  const hearings: Partial<Record<Way, Hearing[]>> = {};
  for (const way of material.ways) hearings[way] = [];
  for (const [i, sentence] of material.sentences.entries()) {
    const utterances = material.utterances[i]!;
    const whole = SpeechAudio.fromPcm(Buffer.concat(utterances.map((audio) => audio.pcm)));
    const ways: Record<Way, () => Promise<Omit<Hearing, 'language' | 'said' | 'speechMs'>>> = {
      pair: () => hear(recognizer, utterances, pair, true),
      any: () => hear(recognizer, utterances, [], false),
      whole: () => hear(recognizer, [whole], pair, true),
    };
    for (const way of material.ways) {
      const heard = await ways[way]();
      hearings[way]!.push({ language: sentence.language, said: sentence.text, speechMs: whole.durationMs, ...heard });
    }
  }
  return hearings;
}

async function hear(
  recognizer: SpeechRecognizer,
  utterances: readonly SpeechAudio[],
  among: readonly LanguageCode[],
  byScript: boolean
): Promise<Omit<Hearing, 'language' | 'said' | 'speechMs'>> {
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
  return { heard: text, heardLanguage: byScript ? languageByScript(text, language) : language, ms };
}

/** The pair of languages the sentences are heard between: theirs when they are in two, or the one given; none otherwise. */
function pairOf(sentences: readonly Sentence[], given: readonly string[] | undefined): LanguageCode[] {
  const tags = given ?? [...new Set(sentences.map((sentence) => sentence.language))];
  return tags.length === 2 ? tags.map((tag) => LanguageCode.of(tag)) : [];
}

/** In a process of its own: hear the sentences with one recognizer, and tell the parent. */
async function child(name: string, dir: string, gapMs: number, given: readonly string[] | undefined): Promise<void> {
  const material = await materialIn(dir, gapMs);
  const config = readModelsConfig(process.env, process.cwd());
  const recognizer = await RECOGNIZERS[name]!(config.modelsDir);
  const hearings = await hearAll(recognizer, material, pairOf(material.sentences, given));
  const report: Report = { hearings, maxRssBytes: process.resourceUsage().maxRSS * 1024 };
  await new Promise<void>((resolve, reject) => process.send!(report, (error) => (error ? reject(error) : resolve())));
  // The channel to the parent would keep this process running.
  process.disconnect();
}

/** Run one recognizer in a process of its own, with the same arguments, and take its report. */
function inProcessOfItsOwn(name: string, args: readonly string[]): Promise<Report> {
  return new Promise((resolve, reject) => {
    // Run as this was run: through ts-node from the source, or as it is once built.
    const execArgv = __filename.endsWith('.ts') ? ['-r', 'ts-node/register'] : [];
    const worker = fork(__filename, [...args, '--child', name], { execArgv, env: { ...process.env, TS_NODE_FILES: 'true' } });
    let report: Report | undefined;
    worker.on('message', (message) => (report = message as Report));
    worker.on('error', reject);
    worker.on('exit', (code) =>
      report ? resolve(report) : reject(new Error(`Hearing with ${name} failed (exit code ${code}); see above`))
    );
  });
}

async function evaluate(dir: string, names: readonly string[], gapMs: number, given: readonly string[] | undefined, args: readonly string[]) {
  const material = await materialIn(dir, gapMs);
  const pair = pairOf(material.sentences, given);
  console.log(pair.length === 2 ? `Hearing between ${pair.join(' and ')}` : 'Hearing among every language: no pair');

  const reports = new Map<string, Report>();
  for (const name of names) {
    console.log(`Hearing ${material.sentences.length} sentences with ${name}`);
    reports.set(name, await inProcessOfItsOwn(name, args));
  }

  const columns = names.flatMap((name) => material.ways.map((way) => ({ name, way })));
  const lines = [
    `# How the sentences were heard\n`,
    `| # | Said | ${columns.map(({ name, way }) => `${name} ${way}`).join(' | ')} |`,
    `|---|---|${columns.map(() => '---').join('|')}|`,
  ];
  for (const [i, sentence] of material.sentences.entries()) {
    const cells = columns.map(({ name, way }) => {
      const hearing = reports.get(name)!.hearings[way]![i]!;
      return cell(hearing.heard, hearing.heardLanguage);
    });
    lines.push(`| ${i + 1} | ${cell(sentence.text, sentence.language)} | ${cells.join(' | ')} |`);
  }

  const summary = [
    `\n## How well each recognizer heard each language\n`,
    ...material.ways.map((way) => `- **${way}:** ${WAYS[way]}`),
    '',
    '| Recognizer | Way | Language | Sentences | Character error rate | Nothing written | Right language | Time a second of speech |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
  for (const { name, way } of columns) {
    for (const s of summariesOf(reports.get(name)!.hearings[way]!)) {
      summary.push(
        `| ${name} | ${way} | ${s.language} | ${s.sentences} | ${percent(s.characterErrorRate)} | ${percent(s.nothingWritten)} | ${percent(s.rightLanguage)} | ${s.msPerSecond.toFixed(0)} ms |`
      );
    }
  }
  summary.push('\n| Recognizer | Most memory taken |', '|---|---|');
  for (const name of names) summary.push(`| ${name} | ${(reports.get(name)!.maxRssBytes / 1_000_000_000).toFixed(2)} GB |`);

  const file = path.join(dir, 'speech-results.md');
  await writeFile(file, `${[...lines, ...summary].join('\n')}\n`);
  console.log(summary.join('\n'));
  console.log(`\nWrote ${file}`);
}

function secondsOf(take: readonly Recording[]): number {
  return (take.at(-1)!.endedAt.getTime() - take[0]!.startedAt.getTime()) / 1000;
}

/** A table cell: the text, with its language. */
function cell(text: string, language: string | null): string {
  return `${text.replace(/\|/g, '\\|') || '—'} [${language ?? '?'}]`;
}

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const gapMs = Number(valueOf('--gap-ms') ?? DEFAULT_GAP_MS);
  const pair = valueOf('--pair')?.split(',');
  const names = (valueOf('--recognizers') ?? 'whisper').split(',').filter(Boolean);
  const values = new Set(['--gap-ms', '--pair', '--recognizers', '--child'].map((flag) => args.indexOf(flag) + 1).filter((i) => i > 0));
  const dir = args.find((arg, i) => !arg.startsWith('--') && !values.has(i));
  const unknown = names.filter((name) => !(name in RECOGNIZERS));
  if (!dir || !Number.isFinite(gapMs) || (pair !== undefined && pair.length !== 2) || names.length === 0 || unknown.length > 0) {
    console.error(USAGE);
    process.exit(2);
  }
  const childOf = valueOf('--child');
  if (childOf !== undefined) return child(childOf, path.resolve(dir), gapMs, pair);
  // Each child is told its recognizer alone.
  const at = args.indexOf('--recognizers');
  const forChildren = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  await evaluate(path.resolve(dir), names, gapMs, pair, forChildren);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
