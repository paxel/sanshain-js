// Fuzz target `response`: what the service answers. The input is read as the body of an
// answer and, split at line feeds, as the values of its Sanshain-Warning headers.
// parseServerJson gives the JSON with every text in it printable, or the SyntaxError of a body
// that is no JSON; warningsOf gives one printable warning per header line. Anything else is a
// finding.
//
//   npm run build && npx jazzer fuzz/response.fuzz.js -- -max_total_time=30

/* global require, module -- a CommonJS file: Jazzer.js loads a target with require */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS, as the built package the target loads from dist/ */
const { parseServerJson } = require('../dist/utils');
const { warningsOf } = require('../dist/api');
/* eslint-enable @typescript-eslint/no-require-imports */

// Every control character but the tab: what may never reach the build log.
// eslint-disable-next-line no-control-regex -- the control characters are what this looks for
const UNPRINTABLE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/;

/**
 * Fails on a text of the parsed answer that is not printable, at any depth.
 *
 * @param {unknown} value
 */
function checkPrintable(value) {
  if (typeof value === 'string') {
    if (UNPRINTABLE.test(value)) throw new Error(`not printable: ${JSON.stringify(value)}`);
  } else if (Array.isArray(value)) {
    value.forEach(checkPrintable);
  } else if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(checkPrintable);
  }
}

/**
 * @param {string} body
 */
function read(body) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = parseServerJson(body);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  checkPrintable(parsed);

  const lines = body.split('\n');
  // The raw response with one value per header line, as Node hands it over.
  const distinct = warningsOf({ request: { res: { headersDistinct: { 'sanshain-warning': lines } } } });
  // The joined value of the headers, and an HTTP layer that hands over a list.
  const joined = warningsOf({ headers: { 'sanshain-warning': body } });
  const listed = warningsOf({ headers: { 'sanshain-warning': lines } });
  if (distinct.length !== lines.length || listed.length !== lines.length || joined.length !== 1) {
    throw new Error(`expected one warning per header line of ${JSON.stringify(body)}`);
  }
  checkPrintable([distinct, joined, listed]);
  // An answer without the header, and no answer at all (a call that never reached the service).
  if (warningsOf({ headers: {} }).length !== 0 || warningsOf(undefined).length !== 0) {
    throw new Error('expected no warning without the header');
  }
}

// What the tests of the other Sanshain clients start from; run once whenever the target loads.
const SEEDS = [
  '{"error":"version 1.2.0 is GA and immutable","proposed_version":"1.2.1"}',
  '{"version":"1.2.0","stability":"snapshot","content_hash":"sha256:a","changes":{"inserts":1,"updates":0,"deletes":0},"harvested_subscriptions":[{"channel":"c","message_name":"m","owner":"","drift":"d"}]}',
  'unknown field `annotations`, expected one of `producername`, `build_url`\nsecond line',
  '<html>\u0000ÿ bad gateway</html>',
  '{"error":7,"changes":[]}',
  '{"error":"line one\\nline two\\u001b[31m","__proto__":{"toString":"\\u0007"}}',
  '"\\u0085"',
  '',
];
for (const seed of SEEDS) read(seed);

/**
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
  read(data.toString('utf8'));
};
