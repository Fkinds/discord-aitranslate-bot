import type { Writable } from 'node:stream';
import winston from 'winston';
import type { Logger } from '../usecases/ports/logger';
import type { LogLevel } from './config';

const SERVICE = 'discord-translator';

/**
 * A Logger that writes one line per entry: the time, the level, the message,
 * then the metadata as JSON. Errors in the metadata are written with their
 * name, message, stack and cause.
 *
 * @param stream where to write; the console when omitted.
 */
export function createLogger(level: LogLevel, stream?: Writable): Logger {
  const format = winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, service: _service, ...meta }) => {
      const line = `${String(timestamp)} [${level}]: ${String(message)}`;
      return Object.keys(meta).length > 0 ? `${line} ${JSON.stringify(meta, withErrors)}` : line;
    })
  );
  const logger = winston.createLogger({
    level,
    format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.splat()),
    defaultMeta: { service: SERVICE },
    transports: [stream ? new winston.transports.Stream({ stream, format }) : new winston.transports.Console({ format })],
  });

  return {
    error: (message, meta) => logger.error(message, meta),
    warn: (message, meta) => logger.warn(message, meta),
    info: (message, meta) => logger.info(message, meta),
    debug: (message, meta) => logger.debug(message, meta),
  };
}

function withErrors(_key: string, value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return { name: value.name, message: value.message, stack: value.stack, cause: value.cause };
}
