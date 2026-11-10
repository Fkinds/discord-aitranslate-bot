import { describe, it, expect } from '@jest/globals';
import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';

// The network policy of medium tests (tests/support/network-policy-environment.js).
describe('network policy of medium tests', () => {
  it('allows a server on localhost', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe('ok');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuses a connection to another host', () => {
    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(
      /Medium tests may only connect to localhost/
    );
  });

  it('refuses fetch() to another host', async () => {
    await expect(fetch('https://example.com/')).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/may only connect to localhost/) }),
    });
  });
});
