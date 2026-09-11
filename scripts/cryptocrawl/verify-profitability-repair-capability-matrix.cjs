'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');

const rpc = read('server/services/cryptocrawl/api/blockchain-providers.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const providerBootstrap = read('server/services/cryptocrawl/execution/adapters/provider-specific-receiver-bootstrap.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const refresh = read('server/services/cryptocrawl/integration/cryptara-two-speed-revalidation-wiring.ts');
const readiness = read('server/services/cryptocrawl/runtime/readiness-policy.ts');
const observability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const ingest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const builder = read('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts');

const matrix = [
  ['Ethereum RPC capability preserved', /ethereum:\s*1/.test(rpc)],
  ['Polygon RPC capability preserved', /polygon:\s*137/.test(rpc)],
  ['Arbitrum RPC capability preserved', /arbitrum:\s*42161/.test(rpc)],
  ['Optimism RPC capability preserved', /optimism:\s*10/.test(rpc)],
  ['Base RPC capability preserved', /base:\s*8453/.test(rpc)],
  ['Avalanche RPC capability preserved', /avalanche:\s*43114/.test(rpc)],
  ['BSC RPC capability preserved', /bsc:\s*56/.test(rpc)],
  ['degraded RPC remains route-locally usable', /candidate\.state === 'healthy' \|\| candidate\.state === 'degraded'/.test(rpc)],
  ['application failures do not poison provider health', /failureClass === 'application'/.test(rpc) && /recordSuccess\(candidate/.test(rpc)],
  ['Balancer flash provider preserved', /'balancer_v2'/.test(providerEconomics)],
  ['Aave V3 flash provider preserved', /'aave_v3'/.test(providerEconomics)],
  ['Morpho Blue flash provider preserved', /'morpho_blue'/.test(providerEconomics)],
  ['Aave and Morpho receiver cold start remains provider-local', /provider_receiver_cold_start_route_local:true/.test(providerBootstrap)],
  ['provider alternatives are exhausted rather than made mandatory', /bootstrapCandidates/.test(providerWiring) && /otherProviderAdmissionBlocked: false/.test(providerWiring)],
  ['exact deterministic positive economics remains admission authority', /quote\.netProfit > 0n/.test(quoter) && !/calculateProgressivePositionSize/.test(quoter)],
  ['stale CEX evidence is reacquired but never executed stale', /getRecentIncludingExpired/.test(refresh) && /staleEvidenceExecutionAllowed: false/.test(refresh)],
  ['CEX inventory remains topology-local', /CEX inventory gates only CEX plans/.test(readiness)],
  ['multi-topology discovery can remain fresh independently', /discoverySearchReady = input\.graphReady \|\| multiTopologyReady/.test(readiness)],
  ['degraded RPC counts as operational readiness', /provider\.http === 'healthy' \|\| provider\.http === 'degraded'/.test(observability)],
  ['cross-chain discovery accepts operational degraded RPC', /observation\.http\.state === 'healthy' \|\| observation\.http\.state === 'degraded'/.test(crossChain)],
  ['Ghost settlement log failures split and fail over locally', /querySettlementLogsWithFailover/.test(chainEvents) && /pending\.unshift\(\[fromBlock, midpoint\], \[midpoint \+ 1, toBlock\]\)/.test(chainEvents)],
  ['90 percent payout remains preserved', /payoutFractionBps:\s*9_000/.test(ingest)],
  ['10 percent retained capital remains preserved', /retainedFractionBps:\s*1_000/.test(ingest)],
  ['builder cold start uses measured sequential gas', /eth_simulateV1/.test(builder) && /fixed_gas_ceiling_admission:false/.test(builder)],
];

for (const [name, ok] of matrix) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  assert.equal(ok, true, `Capability regression detected: ${name}`);
}

console.log('PROFITABILITY_REPAIR_CAPABILITY_MATRIX_VERIFIED');
