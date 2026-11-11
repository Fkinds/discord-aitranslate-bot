import { describe, it, expect } from '@jest/globals';
import { SUPPORTED_LANGUAGES } from '../../../../src/domain/language-code';
import { COMMANDS } from '../../../../src/interfaces/discord/commands';

describe('COMMANDS', () => {
  it('registers the four commands, with the language required only when changing it', () => {
    expect(
      COMMANDS.map(({ name, description, options }) => ({
        name,
        description,
        options: options?.map((option) => ({ name: option.name, required: option.required })),
      }))
    ).toEqual([
      {
        name: 'translate-join',
        description: 'Join voice channel and start real-time translation',
        options: [{ name: 'language', required: false }],
      },
      { name: 'translate-leave', description: 'Leave voice channel and stop translation', options: [] },
      {
        name: 'translate-language',
        description: 'Change translation target language',
        options: [{ name: 'language', required: true }],
      },
      { name: 'translate-status', description: 'Check translation status', options: [] },
    ]);
  });

  it('offers the supported languages, in their order', () => {
    const join = COMMANDS.find((command) => command.name === 'translate-join');
    const choices = (join?.options?.[0] as { choices?: Array<{ name: string; value: string }> }).choices;

    expect(choices).toEqual(SUPPORTED_LANGUAGES.map((language) => ({ name: language.displayName, value: language.tag })));
  });
});
