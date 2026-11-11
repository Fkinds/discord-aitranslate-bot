'use strict';

// Jest test environment that limits network access by test size.
//
// testEnvironmentOptions.network:
//   "none"      small tests: no connection at all, not even to localhost
//   "loopback"  medium tests: only localhost (127.0.0.0/8, ::1) and local sockets
//   "any"       large tests: any host
//
// Every TCP and TLS connection, including fetch() and http.request(), goes
// through net.Socket#connect, so that is the one method patched. The patch is
// installed in setup() and removed in teardown(), so it covers exactly one
// test file; a Jest worker runs one test file at a time.

const net = require('node:net');
const { TestEnvironment } = require('jest-environment-node');

const POLICIES = new Set(['none', 'loopback', 'any']);
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

// Where a net.Socket#connect call is headed. Its arguments come in the forms
// (options[, listener]), (path[, listener]) and (port[, host][, listener]);
// net.connect() passes them on already normalized, as an array.
function destination(args) {
  const [first, second] = args;
  if (Array.isArray(first)) return destination(first);
  if (first !== null && typeof first === 'object') {
    if (first.path !== undefined) return { local: true, label: String(first.path) };
    return { host: first.host ?? 'localhost', port: first.port };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { local: true, label: first };
  return { host: typeof second === 'string' ? second : 'localhost', port: first };
}

// localhost and the loopback addresses (RFC 6761 section 6.3, RFC 1122
// section 3.2.1.3, RFC 4291 section 2.5.3).
function isLoopback(host) {
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name === '::1' ||
    /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(name)
  );
}

// Node's fetch keeps its connection pool, Undici's global dispatcher, on the
// global object under this symbol, and sets it up on first use. Jest gives
// each test file a global object of its own without it, so code that reads
// it, such as @google/genai, fails there but not in Node. Share Node's; its
// connections still go through net.Socket#connect, guarded or not.
function shareFetchDispatcher(testGlobal) {
  new Headers();
  testGlobal[UNDICI_GLOBAL_DISPATCHER] = globalThis[UNDICI_GLOBAL_DISPATCHER];
}

class NetworkPolicyEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    const policy = config.projectConfig.testEnvironmentOptions.network;
    if (!POLICIES.has(policy)) {
      throw new Error(`testEnvironmentOptions.network must be one of ${[...POLICIES].join(', ')}, got ${policy}`);
    }
    this.policy = policy;
    this.size = config.projectConfig.displayName?.name ?? config.projectConfig.displayName;
  }

  async setup() {
    await super.setup();
    shareFetchDispatcher(this.global);
    if (this.policy === 'any') return;

    const { policy, size } = this;
    const connect = net.Socket.prototype.connect;
    this.originalConnect = connect;
    net.Socket.prototype.connect = function guardedConnect(...args) {
      const to = destination(args);
      const allowed = policy === 'loopback' && (to.local || isLoopback(to.host));
      if (!allowed) {
        const target = to.local ? `local socket ${to.label}` : `${to.host}:${to.port}`;
        throw new Error(
          `Network access is not allowed in ${size} tests (tried ${target}). ` +
            (policy === 'none'
              ? 'Move the test to tests/medium if it needs a server on localhost.'
              : 'Medium tests may only connect to localhost.')
        );
      }
      return connect.apply(this, args);
    };
  }

  async teardown() {
    if (this.originalConnect) net.Socket.prototype.connect = this.originalConnect;
    await super.teardown();
  }
}

module.exports = NetworkPolicyEnvironment;
