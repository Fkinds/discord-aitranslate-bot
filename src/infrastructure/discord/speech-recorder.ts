import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GuildId, UserId } from '../../domain/discord-ids';
import type { Clock } from '../../usecases/ports/clock';
import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { toWav } from '../audio/wav';
import type { VoiceListener } from './discord-voice';

/** Writes the bytes to the file, making the directories it is in. */
export type WriteFile = (file: string, bytes: Buffer) => Promise<void>;

async function writeMakingDirectories(file: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

/**
 * The name of the file for an utterance from `startedAt` to `endedAt`, both in
 * the basic format of ISO 8601, in UTC, to the millisecond, so that the names
 * sort by time and hold no colons: "20261126T232500.123Z-20261126T232502.456Z.wav".
 */
export function recordingNameFor(startedAt: Date, endedAt: Date): string {
  const basic = (time: Date) => time.toISOString().replace(/[-:]/g, '');
  return `${basic(startedAt)}-${basic(endedAt)}.wav`;
}

/**
 * Passes on what the bot hears, and records the utterances of one member as
 * WAVE files of the speech the translator gets (16 kHz, mono), to measure how
 * well it is heard (#119). It records no one else.
 *
 * An utterance starts when the member starts speaking, and ends when the bot
 * has had their silence for a while, so its end is that long after they
 * stopped. One with no speech is not recorded. A failure to record is logged,
 * and does not stop the utterance from being translated.
 */
export class RecordingVoiceListener implements VoiceListener {
  constructor(
    private readonly listener: VoiceListener,
    private readonly member: UserId,
    private readonly dir: string,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly write: WriteFile = writeMakingDirectories
  ) {}

  speakingStarted(guildId: GuildId, userId: UserId): void {
    this.listener.speakingStarted(guildId, userId);
  }

  speakingStopped(guildId: GuildId, userId: UserId): void {
    this.listener.speakingStopped(guildId, userId);
  }

  utteranceStarted(guildId: GuildId, userId: UserId, speech: Promise<SpeechAudio>): void {
    if (userId.equals(this.member)) void this.record(this.clock(), speech);
    this.listener.utteranceStarted(guildId, userId, speech);
  }

  disconnected(guildId: GuildId): void {
    this.listener.disconnected(guildId);
  }

  private async record(startedAt: Date, speech: Promise<SpeechAudio>): Promise<void> {
    try {
      const audio = await speech;
      if (audio.isEmpty) return;
      const file = path.join(this.dir, recordingNameFor(startedAt, this.clock()));
      await this.write(file, toWav(audio));
      this.logger.debug('Recorded an utterance', { file });
    } catch (error) {
      this.logger.error('Failed to record an utterance', { error });
    }
  }
}
