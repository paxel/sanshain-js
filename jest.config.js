const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  transform: {
    ...tsJestTransformCfg,
    // commander 15 ships ES modules only. Node 22.12+ loads them from the built
    // CommonJS through require(esm), but Jest does that only from Node 24.9, so
    // under test its files are compiled to CommonJS like ours.
    "^.+/node_modules/commander/.+\\.js$": [
      "ts-jest",
      { tsconfig: { allowJs: true, module: "CommonJS", target: "ES2020" } },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!commander/)"],
};
