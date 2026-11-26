/** Where Ollama listens when OLLAMA_HOST is unset. */
export const DEFAULT_OLLAMA_PORT = 11434;

/**
 * Where to reach Ollama, from the value of OLLAMA_HOST, read as Ollama itself
 * reads it (envconfig.Host in github.com/ollama/ollama):
 * - Spaces and quotation marks around the value are ignored.
 * - Without a scheme, it is http, and the port 11434. With `http://`, the
 *   port is 80; with `https://`, 443. Just `ollama.com` is https.
 * - Without a host, it is 127.0.0.1. A port that is not a number from 0 to
 *   65535 is taken as the default one.
 * - A path after the host is kept, as for Ollama behind a proxy.
 *
 * As the Ollama client does (envconfig.ConnectableHost), an address for
 * listening on every interface (0.0.0.0, ::) is reached on loopback.
 *
 * @throws RangeError when the scheme is not http or https, or the host is not one.
 */
export function ollamaUrlFrom(value: string | undefined): URL {
  const host = (value ?? '').trim().replace(/^["']+|["']+$/g, '').trim();

  let scheme = 'http';
  let rest = host;
  let defaultPort = String(DEFAULT_OLLAMA_PORT);
  const separator = host.indexOf('://');
  if (separator < 0) {
    if (host === 'ollama.com') [scheme, rest] = ['https', 'ollama.com:443'];
  } else {
    scheme = host.slice(0, separator);
    rest = host.slice(separator + 3);
    if (scheme === 'http') defaultPort = '80';
    else if (scheme === 'https') defaultPort = '443';
    else throw new RangeError(`OLLAMA_HOST must be http or https, got ${JSON.stringify(value)}`);
  }

  const slash = rest.indexOf('/');
  const path = slash < 0 ? '' : rest.slice(slash + 1);
  const hostAndPort = slash < 0 ? rest : rest.slice(0, slash);

  let [name, port] = splitHostPort(hostAndPort) ?? [hostAndPort.replace(/^\[(.*)\]$/, '$1'), defaultPort];
  if (!/^[+-]?\d+$/.test(port) || Number(port) > 65_535 || Number(port) < 0) port = defaultPort;
  name = connectable(name);

  try {
    return new URL(`${scheme}://${name.includes(':') ? `[${name}]` : name}:${Number(port)}/${path}`);
  } catch (error) {
    throw new RangeError(`OLLAMA_HOST must be a host, a host and a port, or a URL, got ${JSON.stringify(value)}`, {
      cause: error,
    });
  }
}

/** The host and the port, as Go's net.SplitHostPort splits them; undefined when there is no port, or too many colons. */
function splitHostPort(hostAndPort: string): [string, string] | undefined {
  if (hostAndPort.startsWith('[')) {
    const end = hostAndPort.indexOf(']');
    if (end < 0 || hostAndPort[end + 1] !== ':') return undefined;
    return [hostAndPort.slice(1, end), hostAndPort.slice(end + 2)];
  }
  const colon = hostAndPort.lastIndexOf(':');
  if (colon < 0 || hostAndPort.slice(0, colon).includes(':')) return undefined;
  return [hostAndPort.slice(0, colon), hostAndPort.slice(colon + 1)];
}

/** The host to connect to: loopback for no host, or for an address that means every interface. */
function connectable(host: string): string {
  if (host === '' || host === '0.0.0.0') return '127.0.0.1';
  if (/^[0:]+$/.test(host) && host.includes(':')) return '::1';
  return host;
}

/**
 * Whether Ollama is on the bot's own machine: its host is a loopback address
 * (127.0.0.0/8 or ::1), or localhost.
 */
export function isOnThisMachine(ollama: URL): boolean {
  const host = ollama.hostname;
  return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}
