// Layer rules for src/, checked by `pnpm lint:layers` in CI and before every commit.
// https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
//
//   domain          depends on nothing, not even npm packages or Node.js modules
//   usecases        domain
//   infrastructure  domain, usecases, npm packages, Node.js modules
//   interfaces      domain, usecases, npm packages, Node.js modules
//   main.ts         everything (the composition root)
//
// The pre-layer modules (bot, translation, voice, utils, types, index.ts and
// deploy-commands.ts) are left unchecked until they are removed, but the
// layers must not depend on them.

const LAYERS = '^src/(domain|usecases|infrastructure|interfaces)/';
const LEGACY = '^src/(bot|translation|voice|utils|types)/|^src/(index|deploy-commands)\\.ts$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-depends-on-nothing',
      comment: 'The domain may only import other domain modules.',
      severity: 'error',
      from: { path: '^src/domain/' },
      to: { pathNot: '^src/domain/' },
    },
    {
      name: 'usecases-depend-on-domain-only',
      comment: 'Use cases may only import the domain and other use cases.',
      severity: 'error',
      from: { path: '^src/usecases/' },
      to: { pathNot: '^src/(domain|usecases)/' },
    },
    {
      name: 'infrastructure-not-on-interfaces-or-main',
      comment: 'Infrastructure implements ports; it does not know the inbound side or the composition root.',
      severity: 'error',
      from: { path: '^src/infrastructure/' },
      to: { path: '^src/(interfaces/|main\\.ts$)' },
    },
    {
      name: 'interfaces-not-on-infrastructure-or-main',
      comment: 'Inbound adapters call use cases; main.ts wires infrastructure in.',
      severity: 'error',
      from: { path: '^src/interfaces/' },
      to: { path: '^src/(infrastructure/|main\\.ts$)' },
    },
    {
      name: 'layers-not-on-legacy-modules',
      comment: 'New layers must not depend on the modules they replace.',
      severity: 'error',
      from: { path: LAYERS },
      to: { path: LEGACY },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Type-only imports are dependencies too.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
