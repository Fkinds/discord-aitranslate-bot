import type { ChannelId, GuildId, UserId } from './discord-ids';
import { Entity } from './shared/entity';
import type { TranslationLanguages } from './translation-languages';
import { frozen } from './shared/value-object';

interface SessionState {
  readonly voiceChannelId: ChannelId;
  readonly textChannelId: ChannelId;
  readonly languages: TranslationLanguages;
  readonly startedAtMs: number;
  /** Keyed by the user ID's value, so that equal IDs are one entry. */
  readonly activeSpeakers: ReadonlyMap<string, UserId>;
}

/**
 * Translation running in one Discord server: the bot listens in a voice
 * channel and posts what is said there, translated, to a text channel.
 *
 * Identified by the server, since a server has at most one session. A change
 * returns a new session; this one stays as it was.
 */
export class TranslationSession extends Entity<GuildId> {
  private constructor(
    guildId: GuildId,
    private readonly state: SessionState
  ) {
    super(guildId);
  }

  static start(params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    textChannelId: ChannelId;
    languages: TranslationLanguages;
    startedAt: Date;
  }): TranslationSession {
    const { guildId, startedAt, ...channelsAndLanguages } = params;
    return TranslationSession.build(guildId, {
      ...channelsAndLanguages,
      startedAtMs: startedAt.getTime(),
      activeSpeakers: new Map(),
    });
  }

  private static build(guildId: GuildId, state: SessionState): TranslationSession {
    return frozen(new TranslationSession(guildId, frozen({ ...state })));
  }

  get guildId(): GuildId {
    return this.id;
  }

  get voiceChannelId(): ChannelId {
    return this.state.voiceChannelId;
  }

  get textChannelId(): ChannelId {
    return this.state.textChannelId;
  }

  get languages(): TranslationLanguages {
    return this.state.languages;
  }


  get startedAt(): Date {
    return new Date(this.state.startedAtMs);
  }

  get activeSpeakers(): readonly UserId[] {
    return [...this.state.activeSpeakers.values()];
  }

  /** How long the session has run at `now`; never negative. */
  uptimeMs(now: Date): number {
    return Math.max(0, now.getTime() - this.state.startedAtMs);
  }

  changeLanguages(languages: TranslationLanguages): TranslationSession {
    return TranslationSession.build(this.id, { ...this.state, languages });
  }


  /** A user started speaking. Saying it again changes nothing. */
  speakerStarted(userId: UserId): TranslationSession {
    const speakers = new Map(this.state.activeSpeakers).set(userId.value, userId);
    return TranslationSession.build(this.id, { ...this.state, activeSpeakers: speakers });
  }

  /** A user stopped speaking. Saying it for a silent user changes nothing. */
  speakerStopped(userId: UserId): TranslationSession {
    const speakers = new Map(this.state.activeSpeakers);
    speakers.delete(userId.value);
    return TranslationSession.build(this.id, { ...this.state, activeSpeakers: speakers });
  }
}
