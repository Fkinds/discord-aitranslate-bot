/**
 * Where the adapters and the inbound handlers write what happened.
 *
 * The use cases do not log. The interface lives here because both the
 * inbound side and the outbound adapters use it, and this is a layer both may
 * depend on.
 */
export interface Logger {
  error(message: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
  info(message: string, meta?: Readonly<Record<string, unknown>>): void;
  debug(message: string, meta?: Readonly<Record<string, unknown>>): void;
}
