import { describe, it, expect } from '@jest/globals';
import { commands as oldCommands } from '../../../../src/bot/commands';
import { SUPPORTED_LANGUAGES } from '../../../../src/domain/language-code';
import { COMMANDS } from '../../../../src/interfaces/discord/commands';

describe('COMMANDS', () => {
  it('offers the supported languages, in their order', () => {
    const join = COMMANDS.find((command) => command.name === 'translate-join');
    const choices = (join?.options?.[0] as { choices?: Array<{ name: string; value: string }> }).choices;

    expect(choices).toEqual(SUPPORTED_LANGUAGES.map((language) => ({ name: language.displayName, value: language.tag })));
  });

  // Removed together with src/bot in CA-8.
  it('registers the same commands as before', () => {
    expect(COMMANDS).toEqual(oldCommands);
  });
});
