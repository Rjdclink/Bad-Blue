'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts', 'utf8');

for (const required of [
  'ghostWalletProviderMesh.getProviders(chain)',
  'latestBlockWithFailover',
  'querySettlementLogsWithFailover',
  'collectSettlementLogs',
  'failure.rangeLimited = sawRangeLimit',
  'pending.unshift([fromBlock, midpoint], [midpoint + 1, toBlock])',
  'logBackfillProviderFailover: true',
  'logBackfillAdaptiveRangeSplit: true',
  'for (const log of logs) await ingestGhostWalletSettlementLog(input.chain, log)',
]) {
  assert.ok(source.includes(required), `Ghost settlement log failover verifier missing: ${required}`);
}

assert.doesNotMatch(source, /input\.addresses\.map\(address => input\.provider\.getLogs/);
assert.doesNotMatch(source, /address:\s*input\.addresses/);
assert.match(source, /if \(!rangeLimited \|\| fromBlock >= toBlock\) throw error/);
assert.match(source, /await recordGhostWalletRuntimeState\(\{/);

const ingestIndex = source.indexOf('for (const log of logs) await ingestGhostWalletSettlementLog(input.chain, log)');
const cursorIndex = source.indexOf('await recordGhostWalletRuntimeState({', ingestIndex);
assert.ok(ingestIndex >= 0 && cursorIndex > ingestIndex, 'Durable reconciliation cursor must advance only after complete log ingestion');

console.log('GHOST_SETTLEMENT_LOG_FAILOVER_VERIFIED');
