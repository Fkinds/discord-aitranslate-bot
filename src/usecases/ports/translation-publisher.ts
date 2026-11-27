import type { ChannelId, GuildId, UserId } from '../../domain/discord-ids';
import type { LanguageCode } from '../../domain/language-code';

/** What was said, its translations, and where to post them. */
export interface TranslationPost {
  readonly guildId: GuildId;
  /** The channel to post to. */
  readonly textChannelId: ChannelId;
  /** Who said it. The post names them as the server shows them. */
  readonly speakerId: UserId;
  /** What was said, in the language it was said in. */
  readonly original: string;
  /** What was said, in each language to post it in; none when it was said in the only one. */
  readonly translations: ReadonlyArray<{ readonly language: LanguageCode; readonly text: string }>;
}

/**
 * What the bot tells the members of the server about its voice connection,
 * in the session's text channel:
 *
 * - `connectionLost`: it lost the connection to the voice channel a while
 *   ago, and is trying to get it back.
 * - `connectionBack`: it got the connection back, after saying it had lost it.
 * - `channelGone`: the voice channel is gone, so translation has ended.
 */
export interface SessionNotice {
  readonly kind: 'connectionLost' | 'connectionBack' | 'channelGone';
  readonly guildId: GuildId;
  /** The channel to post to. */
  readonly textChannelId: ChannelId;
  /** The voice channel the notice is about. */
  readonly voiceChannelId: ChannelId;
}

/** Posting failed for a technical reason, such as a missing channel or permission. */
export class PublishFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Posts what was said, and its translations, where the members of the server read them, and tells them about the session. */
export interface TranslationPublisher {
  /** @throws PublishFailed when it cannot be posted. */
  publish(post: TranslationPost): Promise<void>;

  /** @throws PublishFailed when it cannot be posted. */
  announce(notice: SessionNotice): Promise<void>;
}
