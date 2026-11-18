// Fuzz target `config`: sanshain.yaml as any content. loadConfig gives a configuration or
// one of the errors it documents; anything else it throws is a finding.
//
// The first byte decides best effort and how the file begins, the rest is what follows. The
// beginnings lead the fuzzer past the first checks, into the entries of the lists.
//
//   npm run build && npx jazzer fuzz/config.fuzz.js -- -max_total_time=30

/* global require, module, console, Buffer -- a CommonJS file: Jazzer.js loads a target with require */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS, as the built package the target loads from dist/ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { YAMLException } = require('js-yaml');
const { loadConfig, UnknownFieldsError } = require('../dist/config');
/* eslint-enable @typescript-eslint/no-require-imports */

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sanshain-fuzz-config-')), 'sanshain.yaml');

// The puzzled cat goes to stderr for every unknown field; the fuzzer's own report goes there too.
console.error = () => undefined;

/**
 * Whether loadConfig documents this failure: a plain Error names what is wrong with the file,
 * UnknownFieldsError is strict mode refusing unknown fields, YAMLException is js-yaml refusing
 * the syntax.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function documented(error) {
  return (
    error instanceof UnknownFieldsError ||
    error instanceof YAMLException ||
    (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype)
  );
}

/**
 * @param {Buffer} content
 * @param {boolean} bestEffort
 */
function load(content, bestEffort) {
  fs.writeFileSync(file, content);
  /** @type {unknown} */
  let config;
  try {
    config = loadConfig(file, bestEffort);
  } catch (error) {
    if (documented(error)) return;
    throw error;
  }
  if (typeof config !== 'object' || config === null) {
    throw new Error(`expected a configuration or an error, got ${typeof config}`);
  }
}

// What the tests of the other Sanshain clients start from; run once whenever the target loads.
const SEEDS = [
  'sanshainUrl: http://localhost:8080\nserviceName: svc\nprovides:\n  - file: api/openapi.yaml\n',
  'sanshainUrl: http://localhost:8080\nstrict: true\ntypo: 1\nrequires:\n  - serviceName: auth\n    version: 1.2.0\n    outputDirectory: gen\n    endpoints:\n      - method: GET\n        path: /a\n',
  'sanshainUrl: http://localhost:8080\nannotations:\n  - scope: version\n    name: build\n    value: "{{ID}}"\n  - scope: 42\n',
  'sanshainUrl: http://localhost:8080\nprovides:\n  - null\nrequires:\n  - null\n',
  'branch: main\nprovide:\n  timeout: 3\n',
  '- a\n- [b\n',
  '',
];
for (const seed of SEEDS) {
  load(Buffer.from(seed), false);
  load(Buffer.from(seed), true);
}

const BEGINNINGS = [
  '',
  'sanshainUrl: http://localhost:8080\n',
  'sanshainUrl: http://localhost:8080\nserviceName: svc\nprovides:\n  - ',
  'sanshainUrl: http://localhost:8080\nserviceName: svc\nannotations:\n  - scope: version\n    name: build\n    value: ',
  'sanshainUrl: http://localhost:8080\nrequires:\n  - serviceName: auth\n    outputDirectory: gen\n    endpoints:\n      - method: GET\n        path: /a\n    ',
  'sanshainUrl: http://localhost:8080\nrequires:\n  - serviceName: auth\n    version: 1.2.0\n    outputDirectory: gen\n    endpoints:\n      - ',
];

/**
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
  const first = data[0] ?? 0;
  const beginning = BEGINNINGS[(first >> 1) % BEGINNINGS.length] ?? '';
  load(Buffer.concat([Buffer.from(beginning), data.subarray(1)]), (first & 1) === 1);
};
