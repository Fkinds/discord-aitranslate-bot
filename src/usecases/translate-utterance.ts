import type { GuildId, UserId } from '../domain/discord-ids';
import type { SpeechAudio } from './ports/speech-audio';
import type { TranslationPublisher } from './ports/translation-publisher';
import type { Translation, Translator } from './ports/translator';
import type { SessionStore } from './session-store';

export interface TranslateUtteranceCommand {
  readonly guildId: GuildId;
  readonly speakerId: UserId;
  /** What the speaker says, available once they fall silent. */
  readonly audio: Promise<SpeechAudio>;
}

export type TranslateUtteranceResult =
  | { readonly kind: 'posted'; readonly translation: Translation }
  | { readonly kind: 'nothingHeard' }
  | { readonly kind: 'notRunning' };

/**
 * Translate what a member says in the voice channel and post it to the
 * session's text channel.
 *
 * Called when the member starts speaking. As the bot has always done, the
 * session as it is then decides the language and the channel: a language
 * changed while they speak applies from their next utterance, and what was
 * said before the translation stopped is still posted.
 */
export class TranslateUtterance {
  constructor(
    private readonly sessions: SessionStore,
    private readonly translator: Translator,
    private readonly publisher: TranslationPublisher
  ) {}

  /** @throws whatever the audio fails with, TranslationFailed or PublishFailed. */
  async execute(command: TranslateUtteranceCommand): Promise<TranslateUtteranceResult> {
    const session = this.sessions.find(command.guildId);
    // Awaited even without a session, so that a failure reaches the caller.
    const audio = await command.audio;
    if (!session) return { kind: 'notRunning' };
    if (audio.isEmpty) return { kind: 'nothingHeard' };

    const translation = await this.translator.translate(audio, session.targetLanguage);
    await this.publisher.publish({
      guildId: session.guildId,
      textChannelId: session.textChannelId,
      speakerId: command.speakerId,
      translation,
    });
    return { kind: 'posted', translation };
  }
}
