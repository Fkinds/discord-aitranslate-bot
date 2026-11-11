import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { REST } from 'discord.js';
import { registerCommands } from '../../../../src/infrastructure/discord/command-registry';
import { COMMANDS } from '../../../../src/interfaces/discord/commands';
import { HttpStub } from '../../../support/http-stub';

// discord.js's REST client and registerCommands against a Discord API stand-in on localhost.
describe('registerCommands over HTTP', () => {
  let discord: HttpStub;
  let rest: REST;

  beforeEach(async () => {
    discord = await HttpStub.start();
    rest = new REST({ api: `${discord.url}/api`, retries: 0 }).setToken('bot-token');
  });

  afterEach(async () => {
    await discord.stop();
  });

  it("replaces the application's commands with the bot's, and reports what Discord has", async () => {
    discord.respond({
      status: 200,
      body: COMMANDS.map((command, i) => ({ id: String(100 + i), application_id: '123', version: '1', ...command })),
    });

    const registered = await registerCommands(rest, '123', COMMANDS);

    expect(registered).toEqual(COMMANDS.map(({ name, description }) => ({ name, description })));
    expect(discord.requests).toHaveLength(1);
    const [request] = discord.requests;
    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe('/api/v10/applications/123/commands');
    expect(request?.headers.authorization).toBe('Bot bot-token');
    expect(JSON.parse(request?.body ?? '')).toEqual(COMMANDS);
  });

  it('fails when Discord refuses the token', async () => {
    discord.respond({ status: 401, body: { message: '401: Unauthorized', code: 0 } });

    await expect(registerCommands(rest, '123', COMMANDS)).rejects.toThrow('401: Unauthorized');
  });

  it('fails when Discord answers with something other than the commands', async () => {
    discord.respond({ status: 200, body: { unexpected: true } });

    await expect(registerCommands(rest, '123', COMMANDS)).rejects.toThrow('something other than a list of commands');
  });
});
