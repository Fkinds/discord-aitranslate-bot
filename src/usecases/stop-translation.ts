import type { GuildId } from '../domain/discord-ids';
import type { TranslationSession } from '../domain/translation-session';
import type { VoiceConnector } from './ports/voice-connector';
import type { SessionStore } from './session-store';

export interface StopTranslationCommand {
  readonly guildId: GuildId;
}

export type StopTranslationResult =
  | { readonly kind: 'stopped'; readonly session: TranslationSession }
  | { readonly kind: 'notRunning' };

/** Leave the voice channel and stop translating. */
export class StopTranslation {
  constructor(
    private readonly sessions: SessionStore,
    private readonly voice: VoiceConnector
  ) {}

  /** @throws whatever leaving throws; the session is then kept. */
  async execute(command: StopTranslationCommand): Promise<StopTranslationResult> {
    const session = this.sessions.find(command.guildId);
    if (!session) return { kind: 'notRunning' };

    await this.voice.leave(session.guildId);
    this.sessions.remove(session.guildId);
    return { kind: 'stopped', session };
  }
}
