import type { GuildId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';
import type { TranslationPublisher } from './ports/translation-publisher';
import type { SessionStore } from './session-store';

export interface EndDisconnectedSessionCommand {
  readonly guildId: GuildId;
}

export type EndDisconnectedSessionResult =
  | { readonly kind: 'ended'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' };

/**
 * End the server's session after the bot was disconnected from the voice
 * channel for good, because the channel is gone, and say so in the session's
 * text channel. The connection is already gone, so this does not leave.
 */
export class EndDisconnectedSession {
  constructor(
    private readonly sessions: SessionStore,
    private readonly publisher: TranslationPublisher
  ) {}

  /** @throws PublishFailed when it cannot be said; the session has ended all the same. */
  async execute(command: EndDisconnectedSessionCommand): Promise<EndDisconnectedSessionResult> {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    this.sessions.remove(session.guildId);
    const { guildId, textChannelId, voiceChannelId } = session;
    await this.publisher.announce({ kind: 'channelGone', guildId, textChannelId, voiceChannelId });
    return { kind: 'ended', session };
  }
}
