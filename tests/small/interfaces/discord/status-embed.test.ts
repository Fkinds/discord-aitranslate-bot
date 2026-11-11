import { describe, it, expect } from '@jest/globals';
import { UserId } from '../../../../src/domain/discord-ids';
import { formatUptime, statusEmbed } from '../../../../src/interfaces/discord/status-embed';
import { aSession, STARTED_AT } from '../../../support/builders';

describe('formatUptime', () => {
  it.each([
    [0, '0m 0s'],
    [59_999, '0m 59s'],
    [125_000, '2m 5s'],
    [3_599_999, '59m 59s'],
    [3_600_000, '1h 0m'],
    [90_061_000, '25h 1m'],
  ])('shows %i ms as %s', (uptimeMs, shown) => {
    expect(formatUptime(uptimeMs)).toBe(shown);
  });
});

describe('statusEmbed', () => {
  it('shows the language, the uptime, how many are speaking and the channels', () => {
    const session = aSession({ language: 'ko', voice: '10', text: '20' }).speakerStarted(UserId.of('30'));

    const embed = statusEmbed(session, 125_000, STARTED_AT).toJSON();

    expect(embed.title).toBe('📊 Translation Status');
    expect(embed.color).toBe(0x0099ff);
    expect(embed.timestamp).toBe(STARTED_AT.toISOString());
    expect(embed.fields?.map(({ name, value }) => [name, value])).toEqual([
      ['Status', '✅ Active'],
      ['Target Language', 'Korean (한국어)'],
      ['Uptime', '2m 5s'],
      ['Active Users', '1'],
      ['Voice Channel', '<#10>'],
      ['Text Channel', '<#20>'],
    ]);
  });
});
