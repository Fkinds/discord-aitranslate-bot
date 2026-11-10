import type { TranslationPost, TranslationPublisher } from '../../../src/usecases/ports/translation-publisher';

/** A TranslationPublisher that records posts and can be told to fail. */
export class FakeTranslationPublisher implements TranslationPublisher {
  readonly posts: TranslationPost[] = [];
  private error: Error | undefined;

  /** Make the next post fail with this error. */
  failNext(error: Error): void {
    this.error = error;
  }

  async publish(post: TranslationPost): Promise<void> {
    const error = this.error;
    this.error = undefined;
    if (error) throw error;
    this.posts.push(post);
  }
}
