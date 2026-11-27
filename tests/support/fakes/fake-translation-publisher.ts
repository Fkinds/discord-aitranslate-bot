import type { SessionNotice, TranslationPost, TranslationPublisher } from '../../../src/usecases/ports/translation-publisher';

/** A TranslationPublisher that records posts and notices, and can be told to fail. */
export class FakeTranslationPublisher implements TranslationPublisher {
  readonly posts: TranslationPost[] = [];
  readonly notices: SessionNotice[] = [];
  private error: Error | undefined;

  /** Make the next post or notice fail with this error. */
  failNext(error: Error): void {
    this.error = error;
  }

  async publish(post: TranslationPost): Promise<void> {
    this.failIfTold();
    this.posts.push(post);
  }

  async announce(notice: SessionNotice): Promise<void> {
    this.failIfTold();
    this.notices.push(notice);
  }

  private failIfTold(): void {
    const error = this.error;
    this.error = undefined;
    if (error) throw error;
  }
}
