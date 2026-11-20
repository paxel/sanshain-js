#!/usr/bin/env node
/* global require, process -- a CommonJS script, run by Node */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the package is built as CommonJS: require is how it loads
const { program } = require('../dist/cli');
program.parse(process.argv);
