import { describe, it, expect } from '@jest/globals';
import { SUPPORTED_LANGUAGES } from '../../../../src/domain/language-code';
import { COMMANDS } from '../../../../src/interfaces/discord/commands';

describe('COMMANDS', () => {
  it('registers the four commands: the language required only when changing it, and a second language never', () => {
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
        options: [
          { name: 'language', required: false },
          { name: 'second-language', required: false },
        ],
      },
      { name: 'translate-leave', description: 'Leave voice channel and stop translation', options: [] },
      {
        name: 'translate-language',
        description: 'Change translation target language',
        options: [
          { name: 'language', required: true },
          { name: 'second-language', required: false },
        ],
      },
      { name: 'translate-status', description: 'Check translation status', options: [] },
    ]);
  });

  it('offers the supported languages in every language option, in their order', () => {
    const offered = SUPPORTED_LANGUAGES.map((language) => ({ name: language.displayName, value: language.tag }));
    const options = COMMANDS.flatMap((command) => command.options ?? []) as Array<{ choices?: unknown }>;

    expect(options).toHaveLength(4);
    for (const option of options) expect(option.choices).toEqual(offered);
  });
});
