import type { ChannelId, GuildId } from '../domain/discord-ids';
import type { LanguageCode } from '../domain/language-code';
import { TranslationSession } from '../domain/translation-session';
import type { Clock } from './ports/clock';
import type { VoiceConnector } from './ports/voice-connector';
import type { SessionStore } from './session-store';

export interface StartTranslationCommand {
  readonly guildId: GuildId;
  /** The voice channel the requesting member is in, if any. */
  readonly requesterVoiceChannelId: ChannelId | null;
  /** Where the translations are posted: the channel the command came from. */
  readonly textChannelId: ChannelId;
  /** The language to translate into; the default language if omitted. */
  readonly targetLanguage?: LanguageCode;
}

export type StartTranslationResult =
  | { readonly kind: 'started'; readonly session: TranslationSession }
  | { readonly kind: 'requesterNotInVoiceChannel' }
  | { readonly kind: 'alreadyRunning'; readonly session: TranslationSession };

/** Join the requester's voice channel and start translating what is said there. */
export class StartTranslation {
  constructor(
    private readonly sessions: SessionStore,
    private readonly voice: VoiceConnector,
    private readonly clock: Clock,
    private readonly defaultLanguage: LanguageCode
  ) {}

  /** @throws VoiceConnectionFailed when joining fails; no session is left behind. */
  async execute(command: StartTranslationCommand): Promise<StartTranslationResult> {
    // Checked in the order the bot has always checked them.
    if (!command.requesterVoiceChannelId) return { kind: 'requesterNotInVoiceChannel' };
    const running = this.sessions.find(command.guildId);
    if (running) return { kind: 'alreadyRunning', session: running };

    const session = TranslationSession.start({
      guildId: command.guildId,
      voiceChannelId: command.requesterVoiceChannelId,
      textChannelId: command.textChannelId,
      targetLanguage: command.targetLanguage ?? this.defaultLanguage,
      startedAt: this.clock(),
    });
    // Saved before joining, so that a second request while connecting finds it.
    this.sessions.save(session);
    try {
      await this.voice.join(session.guildId, session.voiceChannelId);
    } catch (error) {
      this.sessions.remove(session.guildId);
      throw error;
    }
    return { kind: 'started', session };
  }
}
