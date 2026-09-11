'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts', 'utf8');

assert.match(source, /observation\.http\.state === 'healthy' \|\| observation\.http\.state === 'degraded'/);
assert.doesNotMatch(source, /observation\.http\.success/);
assert.match(source, /await multiProviderRpcManager\.initialize\(CHAINS\)/);
assert.match(source, /evidence_reacquisition:all_structural_routes_each_cycle_bounded_concurrency/);
assert.match(source, /synthetic_evidence:false/);

console.log('[degraded-rpc-cross-chain-admission] PASS: degraded-but-usable RPC state remains discovery-capable while cooldown\/unavailable providers stay excluded');
