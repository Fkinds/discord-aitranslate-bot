import type { ChannelId, GuildId } from '../domain/discord-ids';
import type { LanguageCode } from '../domain/language-code';
import { TranslationLanguages } from '../domain/translation-languages';
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
  /**
   * The language to translate into, or the first of a pair. With neither this
   * nor the second language, the default languages; with only the second,
   * the default first language and the second.
   */
  readonly language?: LanguageCode;
  /** The other language of a pair. */
  readonly secondLanguage?: LanguageCode;
}

export type StartTranslationResult =
  | { readonly kind: 'started'; readonly session: TranslationSession }
  /** A session was running, but its connection was away: the bot joined the requester's channel again. */
  | { readonly kind: 'rejoined'; readonly session: TranslationSession }
  | { readonly kind: 'requesterNotInVoiceChannel' }
  | { readonly kind: 'sameLanguageTwice' }
  | { readonly kind: 'alreadyRunning'; readonly session: TranslationSession };

/**
 * Join the requester's voice channel and start translating what is said there.
 *
 * When the server's session is running, but its voice connection is away,
 * the bot joins the requester's channel again at once, rather than wait for
 * the next time it would have, and goes on translating there in the session's
 * languages: the languages asked for apply only to a session that starts.
 */
export class StartTranslation {
  constructor(
    private readonly sessions: SessionStore,
    private readonly voice: VoiceConnector,
    private readonly clock: Clock,
    private readonly defaultLanguages: TranslationLanguages
  ) {}

  /**
   * @throws VoiceConnectionFailed when joining fails; no session is left
   *   behind. When joining again, only when the bot is not in the server.
   */
  async execute(command: StartTranslationCommand): Promise<StartTranslationResult> {
    // Checked in the order the bot has always checked them, after the
    // languages, which it did not have to check.
    const languages = this.languagesFor(command);
    if (!languages) return { kind: 'sameLanguageTwice' };
    if (!command.requesterVoiceChannelId) return { kind: 'requesterNotInVoiceChannel' };
    const running = this.sessions.find(command.guildId);
    if (running) {
      if (this.voice.isReady(running.guildId)) return { kind: 'alreadyRunning', session: running };
      const moved = running.movedTo(command.requesterVoiceChannelId);
      this.sessions.save(moved);
      await this.voice.rejoin(moved.guildId, moved.voiceChannelId);
      return { kind: 'rejoined', session: moved };
    }

    const session = TranslationSession.start({
      guildId: command.guildId,
      voiceChannelId: command.requesterVoiceChannelId,
      textChannelId: command.textChannelId,
      languages,
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

  /** The languages asked for, or undefined when the second is the first again. */
  private languagesFor({ language, secondLanguage }: StartTranslationCommand): TranslationLanguages | undefined {
    if (!language && !secondLanguage) return this.defaultLanguages;
    const first = language ?? this.defaultLanguages.first;
    return secondLanguage?.equals(first) ? undefined : TranslationLanguages.of(first, secondLanguage);
  }
}
