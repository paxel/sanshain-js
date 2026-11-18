/* global require, module -- a CommonJS file, loaded by Jest */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the package is CommonJS: require is how this file loads
const { createDefaultPreset } = require('ts-jest');

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  // npm run test:coverage: every source file counts, loaded by a test or not, and the
  // gate reads coverage/lcov.info.
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['lcovonly', 'text-summary'],
  transform: {
    ...tsJestTransformCfg,
    // commander 15 ships ES modules only. Node 22.12+ loads them from the built
    // CommonJS through require(esm), but Jest does that only from Node 24.9, so
    // under test its files are compiled to CommonJS like ours.
    '^.+/node_modules/commander/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'CommonJS', target: 'ES2020' } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!commander/)'],
};
