// Fuzz target `state`: the require state file as any content. Reading it never fails, and
// the state it gives can always be looked up, written and saved again.
//
//   npm run build && npx jazzer fuzz/state.fuzz.js -- -max_total_time=30

/* global require, module, Buffer -- a CommonJS file: Jazzer.js loads a target with require */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS, as the built package the target loads from dist/ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SanshainCache } = require('../dist/cache');
/* eslint-enable @typescript-eslint/no-require-imports */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanshain-fuzz-state-'));
const file = path.join(dir, 'state.json');

/**
 * @param {Buffer} content
 */
function read(content) {
  fs.writeFileSync(file, content);
  const cache = new SanshainCache(dir);
  cache.getRequireEntry('key');
  cache.updateRequireEntry('key', 'etag');
  if (cache.getRequireEntry('key')?.etag !== 'etag') {
    throw new Error('expected the entry just written');
  }
  cache.save();
  if (new SanshainCache(dir).getRequireEntry('key')?.etag !== 'etag') {
    throw new Error('expected the saved entry to be read again');
  }
}

// What the tests of the other Sanshain clients start from; run once whenever the target loads.
const SEEDS = [
  '{"requires":{"p|1.0.0|GET|/a|out=gen":{"etag":"abc","last_fetched":"2026-11-18T10:00:00Z"}}}',
  '{"requires":{"key":null}}',
  '{"requires":null}',
  '{"requires":[1,2]}',
  '{"requires":7}',
  '"text"',
  '',
];
for (const seed of SEEDS) read(Buffer.from(seed));

/**
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
  read(data);
};
