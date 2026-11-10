import { DomainError } from './shared/domain-error';
import { frozen, ValueObject } from './shared/value-object';

/**
 * Discord IDs are snowflakes: unsigned 64-bit integers, which Discord always
 * sends as decimal strings.
 * https://discord.com/developers/docs/reference#snowflakes
 */
const MAX_SNOWFLAKE = 2n ** 64n - 1n;

function parseSnowflake(kind: string, value: string): string {
  if (!/^[0-9]{1,20}$/.test(value) || BigInt(value) > MAX_SNOWFLAKE) {
    throw new DomainError(`${kind} must be a Discord snowflake (an unsigned 64-bit integer), got ${JSON.stringify(value)}`);
  }
  return value;
}

abstract class Snowflake extends ValueObject {
  protected constructor(readonly value: string) {
    super();
  }

  protected equalityComponents(): readonly unknown[] {
    return [this.value];
  }

  toString(): string {
    return this.value;
  }
}

/** A Discord server, which the Discord API calls a guild. */
export class GuildId extends Snowflake {
  static of(value: string): GuildId {
    return frozen(new GuildId(parseSnowflake('GuildId', value)));
  }
}

/** A Discord channel, voice or text. */
export class ChannelId extends Snowflake {
  static of(value: string): ChannelId {
    return frozen(new ChannelId(parseSnowflake('ChannelId', value)));
  }
}

/** A Discord user. */
export class UserId extends Snowflake {
  static of(value: string): UserId {
    return frozen(new UserId(parseSnowflake('UserId', value)));
  }
}
