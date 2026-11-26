import { describe, it, expect } from '@jest/globals';
import { isOnThisMachine, ollamaUrlFrom } from '../../../../src/infrastructure/ollama/ollama-host';

describe('ollamaUrlFrom', () => {
  // The cases of TestHost in Ollama's envconfig/config_test.go, with the
  // address the client connects to (TestConnectableHost) and URL's own form:
  // no default port for the scheme, and a path of at least "/".
  it.each([
    ['unset', undefined, 'http://127.0.0.1:11434/'],
    ['empty', '', 'http://127.0.0.1:11434/'],
    ['only address', '1.2.3.4', 'http://1.2.3.4:11434/'],
    ['only port', ':1234', 'http://127.0.0.1:1234/'],
    ['address and port', '1.2.3.4:1234', 'http://1.2.3.4:1234/'],
    ['hostname', 'example.com', 'http://example.com:11434/'],
    ['hostname and port', 'example.com:1234', 'http://example.com:1234/'],
    ['too large port', ':66000', 'http://127.0.0.1:11434/'],
    ['too small port', ':-1', 'http://127.0.0.1:11434/'],
    ['no port after the colon', 'example.com:', 'http://example.com:11434/'],
    ['ipv6 localhost', '[::1]', 'http://[::1]:11434/'],
    ['ipv6 world open', '[::]', 'http://[::1]:11434/'],
    ['ipv6 no brackets', '::1', 'http://[::1]:11434/'],
    ['ipv6 + port', '[::1]:1337', 'http://[::1]:1337/'],
    ['ipv4 world open', '0.0.0.0', 'http://127.0.0.1:11434/'],
    ['extra space', ' 1.2.3.4 ', 'http://1.2.3.4:11434/'],
    ['extra quotes', '"1.2.3.4"', 'http://1.2.3.4:11434/'],
    ['extra space+quotes', ' " 1.2.3.4 " ', 'http://1.2.3.4:11434/'],
    ['extra single quotes', "'1.2.3.4'", 'http://1.2.3.4:11434/'],
    ['http', 'http://1.2.3.4', 'http://1.2.3.4/'],
    ['http port', 'http://1.2.3.4:4321', 'http://1.2.3.4:4321/'],
    ['https', 'https://1.2.3.4', 'https://1.2.3.4/'],
    ['https port', 'https://1.2.3.4:4321', 'https://1.2.3.4:4321/'],
    ['proxy path', 'https://example.com/ollama', 'https://example.com/ollama'],
    ['ollama.com', 'ollama.com', 'https://ollama.com/'],
  ])('reads OLLAMA_HOST as Ollama does: %s', (_, value, expected) => {
    expect(ollamaUrlFrom(value).href).toBe(expected);
  });

  it.each(['tcp://1.2.3.4:11434', 'unix:///tmp/ollama.sock'])('refuses a scheme other than http or https: %s', (value) => {
    expect(() => ollamaUrlFrom(value)).toThrow(`OLLAMA_HOST must be http or https, got ${JSON.stringify(value)}`);
  });

  it('refuses what is not a host', () => {
    expect(() => ollamaUrlFrom('exa mple.com')).toThrow(RangeError);
  });
});

describe('isOnThisMachine', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]', '127.0.1.1:8080', '0.0.0.0', '', 'http://localhost:11434'])(
    'is true for a loopback address or localhost: %j',
    (value) => {
      expect(isOnThisMachine(ollamaUrlFrom(value))).toBe(true);
    }
  );

  it.each(['192.168.1.10', 'example.com', 'https://ollama.com', '[2001:db8::1]', 'localhost.example.com', '128.0.0.1'])(
    'is false for any other host: %j',
    (value) => {
      expect(isOnThisMachine(ollamaUrlFrom(value))).toBe(false);
    }
  );
});
