import type { Clock } from '../../usecases/ports/clock';

/**
 * Runs tasks one at a time, in the order they were given. A task that had to
 * wait for those before it is told how long it waited. One that fails does not
 * hold up the next.
 */
export class SerialQueue {
  private last: Promise<unknown> = Promise.resolve();
  private unfinished = 0;

  constructor(private readonly clock: Clock) {}

  /**
   * Run the task once every task given before it has finished.
   * @param waited told how long the task waited, when it had to.
   */
  run<T>(task: () => Promise<T>, waited: (waitedMs: number) => void = () => {}): Promise<T> {
    const queuedAt = this.clock().getTime();
    const waits = this.unfinished > 0;
    this.unfinished++;

    const result = this.last.then(() => {
      if (waits) waited(this.clock().getTime() - queuedAt);
      return task();
    });
    this.last = result.catch(() => undefined);
    return result.finally(() => this.unfinished--);
  }
}
