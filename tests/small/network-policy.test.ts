import { describe, it, expect } from '@jest/globals';
import * as net from 'node:net';

// The network policy of small tests (tests/support/network-policy-environment.js).
describe('network policy of small tests', () => {
  it('refuses a connection even to localhost', () => {
    expect(() => net.connect(9, '127.0.0.1')).toThrow(/not allowed in small tests/);
  });

  it('refuses a connection to another host', () => {
    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(/not allowed in small tests/);
  });

  it('refuses fetch()', async () => {
    await expect(fetch('https://example.com/')).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/not allowed in small tests/) }),
    });
  });
});
