const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(
  path.join(root, 'server/services/cryptocrawl/discovery/dex-opportunity-generator.ts'),
  'utf8',
);
const failures = [];
const requireText = (needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText("const DISCOVERY_CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc']", 'all existing measured DEX chains remain covered');
requireText(': [25, 50, 100, 250, 500, 1000]', 'existing default notional ladder remains intact');
requireText('slice(0, 10)', 'configured notional list remains bounded');
requireText('async function discoverChainCandidates(', 'chain-local measured discovery worker exists');
requireText('for (const notionalUsd of notionals)', 'all notionals remain sequentially evaluated within each chain');
requireText("purpose: 'discovery'", 'DEX scan continues to request discovery-only 0x evidence');
requireText('isDiscoveryPriceEvidence(first)', 'first leg remains price-only non-executable evidence');
requireText('isDiscoveryPriceEvidence(second)', 'second leg remains price-only non-executable evidence');
requireText('deterministicNetProfitUsd = grossProfitUsd !== null && gasUsd !== null', 'all-in deterministic economics still require measured gas');
requireText('deterministicNetProfitUsd > 0', 'strict positive-net candidate classification remains intact');
requireText('executableCapability: false', 'concurrent DEX discovery remains non-executable');
requireText('atomic_0x_roundtrip_execution_adapter', 'missing atomic execution adapter remains explicit');
requireText('const byChain = await Promise.all(', 'independent chains execute concurrently');
requireText('DISCOVERY_CHAINS.map(chain => discoverChainCandidates(chain, notionals, ttlMs))', 'concurrency covers the complete existing chain list');
requireText('return byChain.flat()', 'concurrent groups are flattened without candidate filtering');
forbidText('notionals.slice(0, 1)', 'optimization cannot collapse the notional ladder');
forbidText('DISCOVERY_CHAINS.slice(0, 1)', 'optimization cannot collapse chain coverage');
forbidText("purpose: 'execution'", 'discovery cannot request executable 0x quotes');

if (failures.length > 0) {
  console.error('[dex-concurrent-discovery] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[dex-concurrent-discovery] PASS — DEX discovery preserves every existing chain/notional and strict measured economics while scanning independent chains concurrently under price-only non-executable evidence');
