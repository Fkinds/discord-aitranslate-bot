import type { GuildId, UserId } from '../../domain/discord-ids';
import type { EndDisconnectedSession } from '../../usecases/end-disconnected-session';
import type { Logger } from '../../usecases/ports/logger';
import type { SpeechAudio } from '../../usecases/ports/speech-audio';
import { PublishFailed } from '../../usecases/ports/translation-publisher';
import { TranslationFailed } from '../../usecases/ports/translator';
import type { RecordSpeakingStarted, RecordSpeakingStopped } from '../../usecases/record-speaking';
import type { TranslateUtterance } from '../../usecases/translate-utterance';
import { unreachable } from '../unreachable';

export interface VoiceEventUseCases {
  readonly recordSpeakingStarted: RecordSpeakingStarted;
  readonly recordSpeakingStopped: RecordSpeakingStopped;
  readonly translateUtterance: TranslateUtterance;
  readonly endDisconnectedSession: EndDisconnectedSession;
}

/**
 * Handles what the bot hears in the voice channels: runs the use case for
 * each event and logs how it went. main.ts hands it to the voice connector
 * as the listener.
 *
 * Never throws, since the events come from Discord's event emitters.
 */
export class VoiceEventHandler {
  constructor(
    private readonly useCases: VoiceEventUseCases,
    private readonly logger: Logger
  ) {}

  speakingStarted(guildId: GuildId, userId: UserId): void {
    this.safely('speakingStarted', guildId, () => {
      this.logger.info('User started speaking', { guildId: guildId.value, userId: userId.value });
      this.useCases.recordSpeakingStarted.execute({ guildId, speakerId: userId });
    });
  }

  speakingStopped(guildId: GuildId, userId: UserId): void {
    this.safely('speakingStopped', guildId, () => {
      this.logger.info('User stopped speaking', { guildId: guildId.value, userId: userId.value });
      this.useCases.recordSpeakingStopped.execute({ guildId, speakerId: userId });
    });
  }

  /** Resolves once the utterance has been posted or dropped; never rejects. */
  async utteranceStarted(guildId: GuildId, userId: UserId, speech: Promise<SpeechAudio>): Promise<void> {
    const ids = { guildId: guildId.value, userId: userId.value };
    try {
      const result = await this.useCases.translateUtterance.execute({ guildId, speakerId: userId, audio: speech });
      switch (result.kind) {
        case 'posted':
          this.logger.info('Translation posted', { ...ids, detectedLanguage: result.translation.detectedLanguage });
          return;
        case 'nothingHeard':
          this.logger.debug('Nothing heard in the utterance', ids);
          return;
        case 'notRunning':
          this.logger.warn('Received audio stream for non-existent session', ids);
          return;
        default:
          unreachable(result);
      }
    } catch (error) {
      const message =
        error instanceof TranslationFailed
          ? 'Failed to translate an utterance'
          : error instanceof PublishFailed
            ? 'Failed to post a translation'
            : 'Failed to process audio stream';
      this.logger.error(message, { ...ids, error });
    }
  }

  disconnected(guildId: GuildId): void {
    this.safely('disconnected', guildId, () => {
      const result = this.useCases.endDisconnectedSession.execute({ guildId });
      if (result.kind === 'ended') {
        this.logger.warn('Voice connection lost; translation ended', { guildId: guildId.value });
      }
    });
  }

  private safely(event: string, guildId: GuildId, handle: () => void): void {
    try {
      handle();
    } catch (error) {
      this.logger.error('Failed to handle a voice event', { event, guildId: guildId.value, error });
    }
  }
}
