// @ts-check
const fs = require('node:fs');
const path = require('node:path');

// Tests are sized by what they depend on, not by how long they take:
//
//   small   in-process only: no network, file I/O, real time or sleeping.
//           Real libraries are fine as long as they do no I/O.
//   medium  this machine only: servers on localhost, no other host.
//
// The first directory under tests/ is the size. Network access is enforced
// per size by tests/support/network-policy-environment.js.
const SIZES = {
  small: { network: 'none' },
  medium: { network: 'loopback' },
};

// Refuse to run while any test file sits outside tests/<size>/, so that no
// test is left without a size, and so without a place in the CI stages.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const unclassified = ['src', 'tests'].flatMap((dir) =>
  fs
    .readdirSync(path.join(__dirname, dir), { recursive: true })
    .map((file) => path.join(dir, String(file)))
    .filter((file) => TEST_FILE.test(file))
    .filter((file) => !Object.keys(SIZES).some((size) => file.startsWith(path.join('tests', size) + path.sep)))
);
if (unclassified.length > 0) {
  throw new Error(
    `Every test file must be under tests/<size>/ (${Object.keys(SIZES).join(', ')}). Unclassified:\n  ` +
      unclassified.join('\n  ')
  );
}

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  verbose: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts', '!src/deploy-commands.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  projects: Object.entries(SIZES).map(([size, { network }]) => ({
    displayName: size,
    preset: 'ts-jest',
    testEnvironment: '<rootDir>/tests/support/network-policy-environment.js',
    testEnvironmentOptions: { network },
    roots: ['<rootDir>/src', `<rootDir>/tests/${size}`],
    testMatch: [`<rootDir>/tests/${size}/**/*.test.ts`],
    transform: { '^.+\\.ts$': 'ts-jest' },
    moduleFileExtensions: ['ts', 'js', 'json'],
    clearMocks: true,
    // No resetMocks: it would wipe the implementations that jest.mock() factories
    // set up once per file, before every test.
    restoreMocks: true,
  })),
};
