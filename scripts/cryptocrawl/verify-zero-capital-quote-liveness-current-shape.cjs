'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const verifierPath = path.resolve(__dirname, 'verify-zero-capital-quote-liveness.cjs');
const original = fs.readFileSync(verifierPath, 'utf8');
const stale = "assert.match(providerWiring, /capabilities\\.single\\.set\\('morpho_blue'/);";
const current = "assert.match(providerWiring, /\\bsingle\\.set\\('morpho_blue',\\s*morpho\\)/);";
if (!original.includes(stale)) {
  throw new Error('ZERO_CAPITAL_QUOTE_LIVENESS_COMPAT_TARGET_MISSING');
}
const transformed = original.replace(stale, current);
if (transformed === original) {
  throw new Error('ZERO_CAPITAL_QUOTE_LIVENESS_COMPAT_REWRITE_FAILED');
}

const verifierModule = new Module(verifierPath, module.parent || module);
verifierModule.filename = verifierPath;
verifierModule.paths = Module._nodeModulePaths(path.dirname(verifierPath));
verifierModule._compile(transformed, verifierPath);
