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

const provider = read('server/services/cryptocrawl/bridge/across-bridge-provider.ts');
const discovery = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const observability = read('server/services/cryptocrawl/integration/across-bridge-observability.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Current Across token identity and quote evidence.
requireText(provider, "https://app.across.to/api/swap/tokens", 'Across token identities come from the current supported-token catalog');
requireText(provider, "https://app.across.to/api/swap/approval", 'Across economics come from the current Swap API approval quote');
requireText(provider, "Authorization: `Bearer ${credentials.apiKey}`", 'Across production requests are authenticated');
requireText(provider, "integratorId: credentials.integratorId", 'Across requests carry the configured 2-byte integrator identity');
requireText(provider, "tradeType: 'exactInput'", 'Cross-chain discovery measures a fixed input amount');
requireText(provider, 'inputToken: inputToken.address', 'origin quote token comes from the current Across catalog');
requireText(provider, 'outputToken: outputToken.address', 'destination quote token comes from the current Across catalog');
requireText(provider, 'tokenCatalogCache', 'supported-token metadata has a bounded reusable cache');
requireText(provider, 'ACROSS_TOKEN_CATALOG_TTL_MS', 'token catalog cache lifetime is explicit');
requireText(provider, 'Approval quotes intentionally are never cached', 'transaction-bearing approval quote remains fresh and uncached');
requireText(provider, 'quoteExpiryTimestamp', 'quote expiry is retained');
requireText(provider, 'expectedFillTimeSec', 'current fill-time evidence is retained');
requireText(provider, 'lpFeeUsd', 'current LP fee evidence is retained');
requireText(provider, 'relayerCapitalFeeUsd', 'current relayer-capital evidence is retained');
requireText(provider, 'destinationGasUsd', 'current destination-gas evidence is retained');
requireText(provider, 'originGasUsd', 'current origin-gas evidence is retained');
requireText(provider, 'totalFeeUsd', 'current total fee evidence is retained');
requireText(provider, 'totalMaxFeeUsd', 'current maximum total fee evidence is retained');
requireText(provider, "simulationSuccess: payload?.swapTx?.simulationSuccess === true", 'provider simulation status is retained without fabrication');
forbidText(provider, '/suggested-fees', 'legacy suggested-fees API cannot become current cross-chain authority');
forbidText(provider, '/available-routes', 'legacy available-routes API cannot become current cross-chain authority');
forbidText(provider, '.usdc', 'static local USDC address cannot become Across quote identity');
forbidText(provider, '.usdt', 'static local USDT address cannot become Across quote identity');

// S-40 — transaction-bound status + chain receipt proof before terminal success.
requireText(provider, 'export async function getAcrossDepositSettlementEvidence', 'Across exposes one-shot deposit settlement verification');
requireText(provider, 'https://app.across.to/api/deposit/status', 'settlement monitoring uses the current authenticated deposit-status API');
requireText(provider, 'depositTxnRef: input.depositTxnRef', 'status lookup is bound to the exact origin deposit transaction');
requireText(provider, "chain,\n      'receipts'", 'fill/refund receipts use the shared RPC receipt authority');
requireText(provider, 'provider.getTransactionReceipt(txHash)', 'settlement independently verifies the chain transaction receipt');
requireText(provider, "providerStatus === 'filled' && destinationChainVerified", 'filled status is bound to the expected destination chain');
requireText(provider, 'destinationReceiptVerified', 'destination receipt proof is explicit');
requireText(provider, 'refundReceiptVerified', 'refund receipt proof is explicit');
requireText(provider, 'const successful = providerStatus === \'filled\' && destinationChainVerified && destinationReceiptVerified', 'terminal bridge success requires destination receipt confirmation');
requireText(provider, "const refunded = providerStatus === 'refunded' && refundReceiptVerified", 'refund settlement requires origin-chain refund receipt confirmation');
requireText(provider, "const financiallyTerminal = successful || refunded || depositFailed", 'financial terminality is separate from raw provider status');
requireText(provider, "['expired', 'auto-refund-pending', 'refund-failed', 'manual-refund-required']", 'expired/recovery states remain nonterminal for financial settlement');
requireText(provider, "authority: 'settlement_evidence_only'", 'settlement verifier owns evidence only, not execution');
requireText(provider, 'executionAuthority: false', 'settlement evidence cannot authorize execution');
requireText(provider, "'settlement_before_learning'", 'settlement evidence preserves settlement-before-learning provenance');

// Truthful provider-health telemetry is evidence only.
requireText(provider, 'export function getAcrossBridgeMetrics()', 'Across exposes typed evidence-health metrics');
requireText(provider, "authority: 'bridge_evidence_only'", 'Across health is bridge-evidence authority only');
for (const field of ['quoteAttempts', 'quotesSucceeded', 'quotesFailed', 'expiredQuotesRejected', 'tokenResolutionFailures', 'settlementChecks', 'settlementIdentityMismatches']) {
  requireText(provider, field, `Across evidence health exposes ${field}`);
}
requireText(observability, 'getAcrossBridgeMetrics()', 'runtime telemetry consumes Across evidence-health metrics');
requireText(observability, 'requiredForGlobalReadiness: false', 'Across outage cannot become global readiness authority');
requireText(observability, 'deterministicProfitAuthority: false', 'Across telemetry cannot authorize deterministic profit');
requireText(observability, 'settlementAuthority: false', 'Across health telemetry cannot itself claim terminal settlement');
requireText(runtime, 'ensureAcrossBridgeObservability()', 'canonical runtime installs optional Across evidence telemetry');
requireText(runtime, 'acrossBridgeGlobalReadinessAuthority: false', 'canonical runtime declares Across non-authoritative for global readiness');
requireText(runtime, 'acrossBridgeExecutionAuthority: false', 'canonical runtime declares Across non-authoritative for execution');

// Coverage-preserving, bounded rotating cross-chain enrichment.
requireText(discovery, "const CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc']", 'all existing measured cross-chain chains are preserved');
requireText(discovery, "const ASSETS = ['USDC', 'USDT'] as const", 'both existing stablecoin assets are preserved');
requireText(discovery, 'for (const from of CHAINS)', 'origin-chain structural coverage is preserved');
requireText(discovery, 'for (const to of CHAINS)', 'destination-chain structural coverage is preserved');
requireText(discovery, 'for (const asset of ASSETS)', 'asset structural coverage is preserved');
requireText(discovery, 'CRYPTOCRAWL_ACROSS_QUOTES_PER_CYCLE', 'Across quote traffic is explicitly bounded per cycle');
requireText(discovery, 'routeCursor = (routeCursor + count) % routes.length', 'bounded quote sampling rotates through the full route universe');
requireText(discovery, 'Promise.allSettled(selected.map(route => getAcrossBridgeQuote', 'selected independent routes are quoted concurrently without failing the full cycle');
requireText(discovery, 'routes.map(route => recordRoute', 'every structural route remains recorded even when not sampled');
requireText(discovery, "status: hasFreshQuote ? 'enriched' : 'observed'", 'fresh quotes enrich rather than erase unsampled routes');
requireText(discovery, 'bridgeUsd: bridgeCostUsd', 'current provider-reported total route fee is attached as bridge cost evidence');
requireText(discovery, 'grossProfitUsd: null', 'bridge cost alone cannot fabricate cross-chain gross profit');
requireText(discovery, 'deterministicNetProfitUsd: null', 'bridge cost alone cannot fabricate deterministic net profit');
requireText(discovery, 'executableCapability: false', 'measured bridge quote cannot authorize execution');
for (const blocker of [
  'cross_chain_transaction_builder_admission',
  'cross_chain_status_monitor_binding',
  'cross_chain_destination_receipt_after_execution',
  'cross_chain_drift_tolerance',
  'cross_chain_failure_recovery',
  'cross_chain_terminal_settlement',
]) requireText(discovery, `'${blocker}'`, `cross-chain execution remains blocked on ${blocker}`);
requireText(discovery, "'across_settlement_monitor:available_but_not_execution_bound'", 'settlement monitor capability is not confused with live execution binding');
requireText(discovery, "'bridge_static_average_costs:non_authoritative'", 'static bridge averages remain quarantined');
requireText(discovery, "'cross_chain_profitability:not_authorized'", 'cross-chain profitability remains explicitly unauthorized');
requireText(discovery, "'synthetic_evidence:false'", 'cross-chain evidence remains measured/non-synthetic');
forbidText(discovery, 'Math.random', 'route sampling cannot randomly skip coverage');

if (failures.length > 0) {
  console.error('[across-cross-chain-economics] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[across-cross-chain-economics] PASS — current Across quote economics, receipt-bound settlement evidence, full structural route coverage, truthful health telemetry, and fail-closed cross-chain execution boundaries are preserved');
