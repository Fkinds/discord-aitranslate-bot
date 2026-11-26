import type { GuildId, UserId } from '../domain/discord-ids';
import type { SpeechAudio } from './ports/speech-audio';
import type { TranslationPublisher } from './ports/translation-publisher';
import { TranslationAbandoned, type SpeechTranslation, type Translator } from './ports/translator';
import type { SessionStore } from './session-store';

export interface TranslateUtteranceCommand {
  readonly guildId: GuildId;
  readonly speakerId: UserId;
  /** What the speaker says, available once they fall silent. */
  readonly audio: Promise<SpeechAudio>;
}

export type TranslateUtteranceResult =
  | { readonly kind: 'posted'; readonly translation: SpeechTranslation }
  | { readonly kind: 'nothingHeard' }
  /** Something was said, but translated into none of the languages it is to be posted in; nothing was posted. */
  | { readonly kind: 'notTranslated' }
  /** The translator gave up on it for waiting too long behind the utterances before it; nothing was posted. */
  | { readonly kind: 'abandoned'; readonly waitedMs: number }
  | { readonly kind: 'notRunning' };

/**
 * Translate what a member says in the voice channel and post it to the
 * session's text channel.
 *
 * Called when the member starts speaking. As the bot has always done, the
 * session as it is then decides the language and the channel: a language
 * changed while they speak applies from their next utterance, and what was
 * said before the translation stopped is still posted.
 *
 * The session's languages decide what is posted, by the language that was
 * spoken (TranslationLanguages.targetsFor). Nothing is posted when nothing
 * was said, or when it was translated into none of those languages. When
 * there were none to translate into, the session's one language having been
 * spoken, what was said is posted on its own. Nothing is posted either for an
 * utterance the translator gave up on, having waited too long.
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

    let heard: SpeechTranslation;
    try {
      heard = await this.translator.translate(audio, session.languages);
    } catch (error) {
      if (error instanceof TranslationAbandoned) return { kind: 'abandoned', waitedMs: error.waitedMs };
      throw error;
    }
    if (heard.original.trim() === '') return { kind: 'nothingHeard' };

    const targets = session.languages.targetsFor(heard.spokenLanguage);
    const translations = heard.translations.filter(({ language }) => targets.some((target) => target.equals(language)));
    if (targets.length > 0 && translations.length === 0) return { kind: 'notTranslated' };

    await this.publisher.publish({
      guildId: session.guildId,
      textChannelId: session.textChannelId,
      speakerId: command.speakerId,
      original: heard.original,
      translations,
    });
    return { kind: 'posted', translation: heard };
  }
}
