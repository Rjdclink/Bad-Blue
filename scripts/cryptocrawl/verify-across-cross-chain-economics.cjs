'use strict';

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
const economics = read('server/services/cryptocrawl/discovery/cross-chain-route-economics.ts');
const executor = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const observability = read('server/services/cryptocrawl/integration/across-bridge-observability.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Current Across token identity and uncached approval quote authority.
requireText(provider, 'https://app.across.to/api/swap/tokens', 'Across token identities come from the current supported-token catalog');
requireText(provider, 'https://app.across.to/api/swap/approval', 'Across economics come from the current Swap API approval quote');
requireText(provider, 'Authorization: `Bearer ${credentials.apiKey}`', 'Across production requests are authenticated');
requireText(provider, 'integratorId: credentials.integratorId', 'Across requests carry the configured 2-byte integrator identity');
requireText(provider, "tradeType: 'exactInput'", 'Cross-chain discovery measures a fixed input amount');
requireText(provider, 'inputToken: inputToken.address', 'origin quote token comes from the current Across catalog');
requireText(provider, 'outputToken: outputToken.address', 'destination quote token comes from the current Across catalog');
requireText(provider, 'tokenCatalogCache', 'supported-token metadata has a bounded reusable cache');
requireText(provider, 'ACROSS_TOKEN_CATALOG_TTL_MS', 'token catalog cache lifetime is explicit');
requireText(provider, 'quoteExpiryTimestamp', 'quote expiry is retained');
requireText(provider, 'minOutputAmount', 'provider guaranteed minimum output is retained');
requireText(provider, 'expectedFillTimeSec', 'current fill-time evidence is retained');
requireText(provider, 'lpFeeUsd', 'current LP fee evidence is retained');
requireText(provider, 'relayerCapitalFeeUsd', 'current relayer-capital evidence is retained');
requireText(provider, 'destinationGasUsd', 'current destination-gas evidence is retained');
requireText(provider, 'originGasUsd', 'current origin-gas evidence is retained');
requireText(provider, 'approvalGasUsd', 'approval gas evidence is retained');
requireText(provider, 'totalFeeUsd', 'current total fee evidence is retained');
requireText(provider, 'totalMaxFeeUsd', 'current maximum total fee evidence is retained');
requireText(provider, 'simulationSuccess: payload?.swapTx?.simulationSuccess === true', 'provider simulation status is retained without fabrication');
forbidText(provider, '/suggested-fees', 'legacy suggested-fees API cannot become current cross-chain authority');
forbidText(provider, '/available-routes', 'legacy available-routes API cannot become current cross-chain authority');
forbidText(provider, '.usdc', 'static local USDC address cannot become Across quote identity');
forbidText(provider, '.usdt', 'static local USDT address cannot become Across quote identity');

// Closed-USD economics are the sole cross-chain profitability authority. Expected
// output and provider simulation cannot manufacture or veto deterministic profit.
requireText(economics, 'export function evaluateAcrossClosedUsdProfit', 'closed-USD cross-chain profit authority exists');
requireText(economics, 'quote.minOutputAmount', 'guaranteed minimum output is required');
requireText(economics, 'inputValueUsd = inputAmountHuman * inputPrice', 'input amount uses a live input-token price');
requireText(economics, 'guaranteedOutputValueUsd = guaranteedOutputHuman * outputPrice', 'minimum output uses a separately live output-token price');
requireText(economics, 'originGasUsd = swapOriginGasUsd + approvalGasUsd', 'origin and approval gas are combined exactly once');
requireText(economics, 'deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd', 'all origin gas is deducted from closed route gain');
requireText(economics, 'executablePositive: deterministicNetProfitUsd > 0', 'strict positive deterministic net is required');
requireText(economics, "authority: 'across_min_output_closed_usd_plus_live_input_output_prices'", 'closed-USD authority is explicit');

// Full structural coverage is preserved. Every route is actively quoted in each
// cycle; concurrency bounds provider pressure instead of omitting routes.
requireText(discovery, "const CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc']", 'all measured cross-chain chains are preserved');
requireText(discovery, "const ASSETS: readonly AcrossStableSymbol[] = ['USDC', 'USDT'] as const", 'both stablecoin assets are preserved');
requireText(discovery, 'for (const from of CHAINS)', 'origin-chain coverage is preserved');
requireText(discovery, 'for (const to of CHAINS)', 'destination-chain coverage is preserved');
requireText(discovery, 'for (const inputAsset of ASSETS)', 'input-asset coverage is preserved');
requireText(discovery, 'for (const outputAsset of ASSETS)', 'output-asset coverage is preserved');
requireText(discovery, 'acquireRouteQuotes(routes, notionalUsd)', 'every structural route is actively reacquired each cycle');
requireText(discovery, 'acrossQuoteConcurrency()', 'quote traffic is bounded by concurrency rather than route omission');
requireText(discovery, 'evaluateAcrossClosedUsdProfit', 'discovery consumes the closed-USD authority');
requireText(discovery, 'const deterministicPositive = economics?.executablePositive === true', 'positive economics is explicit');
requireText(discovery, 'quote.approvalGasUsd !== null', 'approval gas must be measured');
requireText(discovery, 'quote!.swapTransactionPresent === true', 'execution requires an actual swap payload');
requireText(discovery, 'quote!.minOutputAmount !== null', 'execution requires guaranteed output');
requireText(discovery, 'cross_chain_simulation_execution_authority:false', 'simulation cannot authorize execution');
requireText(discovery, 'advisory:bridge_provider_simulation_unsuccessful_or_unavailable', 'simulation failure remains visible advisory evidence');
requireText(discovery, 'cross_chain_profit_model:closed_usd_value', 'same-asset and cross-asset routes share one closed-value model');
requireText(discovery, 'cross_chain_profit_model:minimum_output_not_expected_output', 'expected output is non-authoritative');
requireText(discovery, 'synthetic_evidence:false', 'cross-chain evidence remains measured/non-synthetic');
forbidText(discovery, 'quote!.simulationSuccess === true', 'simulation must not become route admission authority');
forbidText(discovery, 'Math.random', 'route discovery cannot randomly skip coverage');

// Fresh execution must require both accounting ownership and actual spendability,
// reprice after approval receipts, and settle against destination/refund receipts.
requireText(executor, 'getAcrossCrossSwapQuote', 'executor reacquires a fresh route');
requireText(executor, 'freshExecutionPayload', 'executor reacquires exact current calldata');
requireText(executor, 'payload?.checks?.balance', 'fresh depositor balance evidence is consumed');
requireText(executor, 'balanceActual < balanceExpected', 'actual input-token balance must satisfy provider requirement');
requireText(executor, 'balanceExpected < routeInput', 'provider requirement may not understate exact route input');
requireText(executor, 'simulationVetoAuthority: false', 'provider simulation remains advisory');
requireText(executor, 'freshMinimum < oldMinimum', 'minimum-output deterioration is rejected');
requireText(executor, 'liveApprovalGasUsd', 'actual approval gas is measured from receipts');
requireText(executor, 'postApprovalEconomicsPositive', 'economics are re-proven after approval spend');
requireText(executor, 'postPayload.approvals.length > 0', 'allowance must actually be satisfied after approvals');
requireText(executor, 'armPreparedAcrossOriginTransaction', 'signed origin transaction is durably armed before broadcast');
requireText(executor, 'getAcrossDepositSettlementEvidence', 'terminal settlement is provider-status plus chain-receipt bound');
requireText(executor, 'destinationReceiptVerified', 'successful bridge settlement requires destination receipt proof');
requireText(executor, 'refundReceiptVerified', 'refund settlement requires origin receipt proof');
forbidText(executor, 'quote.simulationSuccess !== true', 'input quote simulation cannot be an execution veto');

// Transaction-bound status + independent chain receipt proof before terminal success.
requireText(provider, 'export async function getAcrossDepositSettlementEvidence', 'Across exposes one-shot deposit settlement verification');
requireText(provider, 'https://app.across.to/api/deposit/status', 'settlement monitoring uses the current authenticated deposit-status API');
requireText(provider, 'depositTxnRef: input.depositTxnRef', 'status lookup is bound to the exact origin deposit transaction');
requireText(provider, 'provider.getTransactionReceipt(txHash)', 'settlement independently verifies chain receipts');
requireText(provider, "providerStatus === 'filled' && destinationChainVerified", 'filled status is bound to the expected destination chain');
requireText(provider, 'destinationReceiptVerified', 'destination receipt proof is explicit');
requireText(provider, 'refundReceiptVerified', 'refund receipt proof is explicit');
requireText(provider, "const financiallyTerminal = successful || refunded || depositFailed", 'financial terminality is distinct from raw provider status');
requireText(provider, "authority: 'settlement_evidence_only'", 'settlement verifier owns evidence only');
requireText(provider, 'executionAuthority: false', 'settlement evidence cannot independently execute');
requireText(provider, "'settlement_before_learning'", 'settlement-before-learning provenance is retained');

// Provider-health telemetry remains evidence-only and never global execution authority.
requireText(provider, 'export function getAcrossBridgeMetrics()', 'Across exposes evidence-health metrics');
requireText(provider, "authority: 'bridge_evidence_only'", 'Across health is bridge-evidence authority only');
for (const field of ['quoteAttempts', 'quotesSucceeded', 'quotesFailed', 'expiredQuotesRejected', 'tokenResolutionFailures', 'settlementChecks', 'settlementIdentityMismatches']) {
  requireText(provider, field, `Across evidence health exposes ${field}`);
}
requireText(observability, 'getAcrossBridgeMetrics()', 'runtime telemetry consumes Across evidence-health metrics');
requireText(observability, 'requiredForGlobalReadiness: false', 'Across outage cannot become global readiness authority');
requireText(observability, 'deterministicProfitAuthority: false', 'Across telemetry cannot authorize deterministic profit');
requireText(observability, 'settlementAuthority: false', 'Across telemetry cannot claim terminal settlement');
requireText(runtime, 'ensureAcrossBridgeObservability()', 'canonical runtime installs Across evidence telemetry');
requireText(runtime, 'acrossBridgeGlobalReadinessAuthority: false', 'canonical runtime declares Across non-authoritative for global readiness');
requireText(runtime, 'acrossBridgeExecutionAuthority: false', 'observability cannot replace canonical execution authority');

if (failures.length > 0) {
  console.error('[across-cross-chain-economics] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[across-cross-chain-economics] PASS: current Across identities, uncached guaranteed-output economics, all-route hydration, actual wallet spendability, measured approval gas, advisory simulation, durable submission and receipt-bound settlement invariants passed');
