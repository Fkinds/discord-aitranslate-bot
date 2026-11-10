import type { GuildId, UserId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';
import type { SessionStore } from './session-store';

export interface RecordSpeakingCommand {
  readonly guildId: GuildId;
  readonly speakerId: UserId;
}

export type RecordSpeakingResult =
  | { readonly kind: 'recorded'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' };

/** Record that a member started speaking, for the status to show. */
export class RecordSpeakingStarted {
  constructor(private readonly sessions: SessionStore) {}

  execute(command: RecordSpeakingCommand): RecordSpeakingResult {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    const updated = session.speakerStarted(command.speakerId);
    this.sessions.save(updated);
    return { kind: 'recorded', session: updated };
  }
}

/** Record that a member stopped speaking. */
export class RecordSpeakingStopped {
  constructor(private readonly sessions: SessionStore) {}

  execute(command: RecordSpeakingCommand): RecordSpeakingResult {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    const updated = session.speakerStopped(command.speakerId);
    this.sessions.save(updated);
    return { kind: 'recorded', session: updated };
  }
}
