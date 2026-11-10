import { describe, it, expect } from '@jest/globals';
import { ChannelId, GuildId, UserId } from '../../../src/domain/discord-ids';
import { DomainError } from '../../../src/domain/shared/domain-error';

const MAX = (2n ** 64n - 1n).toString(); // 18446744073709551615, 20 digits

describe('Discord IDs', () => {
  describe.each([
    ['GuildId', GuildId.of],
    ['ChannelId', ChannelId.of],
    ['UserId', UserId.of],
  ])('%s.of', (_kind, of) => {
    it.each([
      ['a single digit', '0'],
      ['a typical snowflake', '1234567890123456789'],
      ['the largest 64-bit value', MAX],
    ])('accepts %s', (_case, value) => {
      expect(of(value).value).toBe(value);
    });

    it.each([
      ['an empty string', ''],
      ['a value above 64 bits', (2n ** 64n).toString()],
      ['21 digits', '1'.repeat(21)],
      ['a negative number', '-1'],
      ['letters', '12ab'],
      ['surrounding spaces', ' 123 '],
      ['a decimal point', '1.5'],
    ])('rejects %s', (_case, value) => {
      expect(() => of(value)).toThrow(DomainError);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(of('1'))).toBe(true);
    });
  });

  it('is equal to the same ID of the same kind', () => {
    expect(GuildId.of('42').equals(GuildId.of('42'))).toBe(true);
    expect(GuildId.of('42').equals(GuildId.of('43'))).toBe(false);
  });

  it('is not equal to an ID of another kind with the same value', () => {
    expect(GuildId.of('42').equals(ChannelId.of('42'))).toBe(false);
    expect(ChannelId.of('42').equals(UserId.of('42'))).toBe(false);
  });

  it('prints as its value', () => {
    expect(`${UserId.of('42')}`).toBe('42');
  });
});
