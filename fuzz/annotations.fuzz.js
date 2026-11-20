// Fuzz target `annotations`: filling the placeholders of annotation values with any value,
// any --set pair and any environment. fillAnnotations documents no error, so whatever it
// throws is a finding, and every entry is either kept or left out with a warning.
//
// The first line holds the annotation values, separated by tabs. Every further line is a
// NAME=value pair, by turns a --set pair and an environment variable.
//
//   npm run build && npx jazzer fuzz/annotations.fuzz.js -- -max_total_time=30

/* global require, module -- a CommonJS file: Jazzer.js loads a target with require */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS, as the built package the target loads from dist/ */
const { fillAnnotations, SET_ENV_PREFIX } = require('../dist/config');
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * @param {string} text
 */
function fill(text) {
  const [first = '', ...pairs] = text.split('\n');
  const declared = first.split('\t').map((value, i) => ({
    scope: /** @type {'version' | 'system'} */ (i % 2 === 1 ? 'system' : 'version'),
    name: 'annotation',
    value,
  }));
  /** @type {Map<string, string>} */
  const sets = new Map();
  /** @type {Record<string, string>} */
  const environment = {};
  pairs.forEach((line, i) => {
    const at = line.indexOf('=');
    if (at < 0) return;
    const name = line.slice(0, at);
    const value = line.slice(at + 1);
    if (i % 2 === 0) {
      sets.set(name, value);
    } else {
      environment[SET_ENV_PREFIX + name] = value;
    }
  });
  const { annotations, warnings } = fillAnnotations(declared, sets, environment);
  if (annotations.length + warnings.length !== declared.length) {
    throw new Error(
      `${String(declared.length)} declared, but ${String(annotations.length)} kept and ${String(warnings.length)} left out`,
    );
  }
}

// What the tests of the other Sanshain clients start from; run once whenever the target loads.
const SEEDS = [
  'build {{ID}}\t{{TEAM}}\nID=42\nTEAM=core',
  '{{MISSING}}\tplain\t{{ a }}{{}}\nMISSING=',
  '{{A}}{{B}}{{A}}\nA={{B}}\nB=x\nA=y',
  '{{__proto__}}\t{{constructor}}\t{{toString}}\n__proto__=x',
  '',
];
for (const seed of SEEDS) fill(seed);

/**
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
  fill(data.toString('utf8'));
};
