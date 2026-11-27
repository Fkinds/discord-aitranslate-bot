import type { GuildId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';
import type { TranslationPublisher } from './ports/translation-publisher';
import type { SessionStore } from './session-store';

export interface ReportConnectionCommand {
  readonly guildId: GuildId;
}

export type ReportConnectionResult =
  | { readonly kind: 'reported'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' };

/**
 * Tell the members, in the session's text channel, that the bot lost its
 * voice connection a while ago and is trying to get it back, so that they
 * know why nothing is translated. The session goes on.
 */
export class ReportConnectionLost {
  constructor(
    private readonly sessions: SessionStore,
    private readonly publisher: TranslationPublisher
  ) {}

  /** @throws PublishFailed when it cannot be posted. */
  async execute(command: ReportConnectionCommand): Promise<ReportConnectionResult> {
    return report(this.sessions, this.publisher, command, 'connectionLost');
  }
}

/** Tell the members, in the session's text channel, that the bot got its voice connection back after it was lost. */
export class ReportConnectionBack {
  constructor(
    private readonly sessions: SessionStore,
    private readonly publisher: TranslationPublisher
  ) {}

  /** @throws PublishFailed when it cannot be posted. */
  async execute(command: ReportConnectionCommand): Promise<ReportConnectionResult> {
    return report(this.sessions, this.publisher, command, 'connectionBack');
  }
}

async function report(
  sessions: SessionStore,
  publisher: TranslationPublisher,
  command: ReportConnectionCommand,
  kind: 'connectionLost' | 'connectionBack'
): Promise<ReportConnectionResult> {
  const session = sessions.find(command.guildId);
  if (!session) return { kind: 'notRunning' };

  const { guildId, textChannelId, voiceChannelId } = session;
  await publisher.announce({ kind, guildId, textChannelId, voiceChannelId });
  return { kind: 'reported', session };
}
