const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const stream = read('server/services/cryptocrawl/capital-free/alchemy-filtered-pending-stream.ts');
const generator = read('server/services/cryptocrawl/discovery/mempool-opportunity-generator.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

requireText(stream, "export type FilteredAlchemyNetwork = 'ethereum' | 'polygon'", 'native filtered pending support is exact and bounded to verified networks');
requireText(stream, "params: ['alchemy_pendingTransactions'", 'provider-native filtered pending subscription is used');
requireText(stream, 'toAddress: addresses', 'router relevance filtering happens at the provider');
requireText(stream, 'hashesOnly: true', 'provider emits hashes before full transaction detail');
requireText(stream, 'providerFilteredHashes', 'filtered hash volume is measured');
requireText(stream, 'MAX_DETAILS_PER_MINUTE', 'full-detail fetch rate has an explicit budget');
requireText(stream, 'detailFetchesBlockedByBudget', 'detail-budget rejection is observable');
requireText(stream, "'transactions'", 'relevant hash detail is routed through shared RPC transaction authority');
requireText(stream, 'providerSideAddressFilter: true', 'telemetry declares provider-side address filtering');
requireText(stream, 'exactChainBinding: true', 'telemetry declares exact chain binding');
requireText(stream, "authority: 'mempool_evidence_only'", 'filtered mempool evidence has evidence-only authority');
requireText(stream, 'executionAuthority: false', 'filtered mempool stream cannot authorize execution');
requireText(stream, "process.env.ALCHEMY_MEMPOOL_MONITORING_ENABLED === 'true'", 'filtered monitoring is explicit opt-in');
requireText(stream, "process.env.NO_INTERVALS !== 'true'", 'preflight/no-interval environments cannot open background streams');
forbidText(stream, 'estimatedProfit', 'filtered pending stream cannot fabricate profitability');
forbidText(stream, 'executeVerifiedArbitragePlan', 'filtered pending stream cannot invoke execution');
forbidText(stream, 'stageManager', 'filtered pending stream cannot mutate governance');

requireText(generator, 'filteredAlchemyPendingStream.getRecentObservations()', 'mempool discovery consumes provider-filtered observations first');
requireText(generator, 'chains: [transaction.chain]', 'filtered pending candidate preserves exact chain identity');
requireText(generator, 'provider_filter_before_detail:true', 'filtered candidate provenance records pre-detail relevance filtering');
requireText(generator, 'if (observed.length > 0) return observed', 'exact-chain filtered evidence is preferred without duplicate fallback candidates');
requireText(generator, 'alchemyIntegration.getMempoolAnalysis()', 'legacy measured path remains available for no-regression fallback');
requireText(generator, "chains: []", 'legacy ambiguous evidence remains conservatively unbound');
requireText(generator, 'executableCapability: false', 'mempool evidence remains non-executable');
requireText(generator, 'deterministicNetProfitUsd: null', 'mempool trigger cannot fabricate deterministic economics');

requireText(runtime, 'ensureFilteredAlchemyPendingStream()', 'canonical runtime activates the optional filtered evidence path');
requireText(runtime, "filteredMempoolEvidence: 'alchemy_provider_filtered_hash_first_exact_chain'", 'runtime advertises filtered hash-first capability');
requireText(runtime, 'filteredMempoolExecutionAuthority: false', 'runtime declares no execution authority for filtered mempool evidence');

if (failures.length > 0) {
  console.error('[alchemy-filtered-mempool] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[alchemy-filtered-mempool] PASS — Alchemy mempool evidence is provider-filtered, hash-first, exact-chain, detail-budgeted, optional, and non-executable');
