const fs = require('fs');

const path = 'server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts';
const source = fs.readFileSync(path, 'utf8');

const required = [
  "classifyRpcOperationError(error, 'logs')",
  "multiProviderRpcManager.execute(input.chain, 'logs'",
  'isAdaptiveLogRangeFailure(error)',
  'pending.unshift([fromBlock, midpoint], [midpoint + 1, toBlock])',
  "multiProviderRpcManager.execute(input.chain, 'contract_calls'",
  "multiProviderRpcManager.execute(chain, 'blocks'",
  'collectBorrowEvents({ chain, pool, fromBlock, toBlock: latestBlock })',
];

for (const fragment of required) {
  if (!source.includes(fragment)) {
    throw new Error(`Liquidation log failover verifier missing required fragment: ${fragment}`);
  }
}

if (source.includes('collectBorrowEvents({ chain, contract,')) {
  throw new Error('Liquidation event collection must not remain pinned to one preselected RPC provider');
}

if (source.includes('contract: Contract;')) {
  throw new Error('Liquidation borrower health must not remain pinned to one preselected RPC provider');
}

if (!source.includes('windowSize <= minimumWindow')) {
  throw new Error('Adaptive log splitting must terminate at a bounded minimum window');
}

console.log('LIQUIDATION_LOG_RANGE_FAILOVER_VERIFIED');
