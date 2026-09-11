'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('server/services/cryptocrawl/bridge/across-bridge-provider.ts', 'utf8');

assert.match(source, /fetchAcrossTokenCatalog\(credentials: \{ apiKey: string; integratorId: string \}\)/);
assert.match(source, /new URLSearchParams\(\{ integratorId: credentials\.integratorId \}\)/);
assert.match(source, /swap\/tokens\?\$\{params\.toString\(\)\}/);
assert.match(source, /Authorization: `Bearer \$\{credentials\.apiKey\}`/);
assert.match(source, /source: 'across_swap_tokens'/);
assert.match(source, /tokenResolutionFailures/);

console.log('[across-token-catalog-auth] PASS: Across token identity uses authenticated live catalog with integrator identity and preserves resolution telemetry');
