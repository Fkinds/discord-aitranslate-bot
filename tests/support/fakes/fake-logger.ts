import type { Logger } from '../../../src/usecases/ports/logger';

type Level = 'error' | 'warn' | 'info' | 'debug';

/** A Logger that keeps what is logged, for tests to read. */
export class FakeLogger implements Logger {
  readonly entries: Array<{ level: Level; message: string; meta?: Readonly<Record<string, unknown>> }> = [];

  error = this.at('error');
  warn = this.at('warn');
  info = this.at('info');
  debug = this.at('debug');

  /** The messages logged at this level, in order. */
  messages(level: Level): string[] {
    return this.entries.filter((entry) => entry.level === level).map((entry) => entry.message);
  }

  private at(level: Level) {
    return (message: string, meta?: Readonly<Record<string, unknown>>): void => {
      this.entries.push({ level, message, meta });
    };
  }
}
