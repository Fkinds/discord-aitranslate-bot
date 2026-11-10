import type { ChannelId, GuildId, UserId } from '../../domain/discord-ids';
import type { Translation } from './translator';

/** A translation, and where to post it. */
export interface TranslationPost {
  readonly guildId: GuildId;
  /** The channel to post to. */
  readonly textChannelId: ChannelId;
  /** Who said it. The post names them as the server shows them. */
  readonly speakerId: UserId;
  readonly translation: Translation;
}

/** Posting failed for a technical reason, such as a missing channel or permission. */
export class PublishFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Posts translations where the members of the server read them. */
export interface TranslationPublisher {
  /** @throws PublishFailed when it cannot be posted. */
  publish(post: TranslationPost): Promise<void>;
}
