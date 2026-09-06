const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const frontier = read('server/services/cryptocrawl/integration/bps-frontier-wave3-wiring.ts');
const admission = read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');
const dexDiscovery = read('server/services/cryptocrawl/discovery/dex-opportunity-generator.ts');
const zeroXFees = read('server/services/cryptocrawl/intelligence/zerox-fee-economics.ts');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('Lighter official public funding endpoint is used', frontier.includes("https://mainnet.zklighter.elliot.ai/api/v1/funding-rates"));
check('Lighter discovery introduces no API key requirement', !/LIGHTER_[A-Z_]*API_KEY|LIGHTER_API_KEY/.test(frontier));
check('Lighter observation is never executable authority', frontier.includes("executableCapability: false") && frontier.includes("execution_promotion:false"));
check('Lighter account tier fee is unknown until measured', frontier.includes('feeUsd: null') && frontier.includes('lighter_exact_account_tier_fee_evidence'));
check('Lighter hidden latency is never assigned synthetic BPS', frontier.includes('lighter_measured_execution_latency_cost') && frontier.includes('hiddenLatencyBpsAssumed: false'));
check('Lighter system-owned collateral provenance is required', frontier.includes('lighter_system_owned_margin_collateral_provenance') && frontier.includes('personal_collateral_allowed:false'));
check('smart-order frontier requires canonical measured net and all-in BPS', frontier.includes('candidate.canonicalBps.netBps') && frontier.includes('candidate.canonicalBps.allInCostBps'));
check('smart-order frontier compares exact like-sized notionals', frontier.includes('candidate.canonicalBps.notionalUsd') && frontier.includes('notionalUsd.toFixed(2)') && frontier.includes("`${assets.join('/')}:${chains}:${notionalUsd.toFixed(2)}`"));
check('route tournament ranks fresh canonical net outcome before explicit-cost tiebreak', frontier.includes('right.netBps - left.netBps') && frontier.includes('left.allInCostBps - right.allInCostBps'));
check('route advantage is measured from canonical net outcome', frontier.includes('winner.netBps - runnerUp.netBps'));
check('explicit cost savings remain separately measured', frontier.includes('runnerUp.allInCostBps - winner.allInCostBps'));
check('contemporaneous route comparison is bounded', frontier.includes('CRYPTOCRAWL_BPS_ROUTE_COMPARISON_MAX_SKEW_MS') && frontier.includes('freshestObservedAt - route.observedAt <= maxSkewMs'));
check('frontier cannot manufacture same-route savings', frontier.includes('Multiple snapshots of the same exact route must not manufacture'));
check('frontier advertises no independent execution authority', frontier.includes("executionAuthority: false") && !frontier.includes('executionAuthority: true'));
check('frontier does not import a strategy executor', !/centralizedExchangeExecutor|zeroCapitalEngine|executePrepared|submitOrder/.test(frontier));
check('direct-vs-aggregator credit requires canonical net measurement', frontier.includes("directVsAggregatorPolicy: 'only_measured_canonical_net_outcomes_and_costs_may_report_route_advantage'"));
check('Uniswap v4 cannot receive unmeasured BPS credit', frontier.includes('requires_exact_pool_quote_before_economic_credit'));
check('intent/solver surfaces cannot bypass zero-personal-resource proof', frontier.includes('zero_personal_resource_proof_before_admission'));
check('MEV/private builder reductions require terminal realized evidence', frontier.includes('terminal_realized_evidence_before_bps_credit'));
check('0x explicit fee object is normalized', zeroXFees.includes("field === 'zeroExFee'") && zeroXFees.includes("field === 'integratorFee'") && zeroXFees.includes("field === 'integratorFees'"));
check('0x sell-amount fees are attribution-only and never double-subtracted', zeroXFees.includes('embedded_fees_are_reflected_by_quote_output_and_must_not_be_subtracted_twice') && dexDiscovery.includes('0x:embedded_fee_double_count:false'));
check('0x native/unknown explicit fee surfaces fail closed for DEX promotion', zeroXFees.includes("'external_native_transaction_cost'") && zeroXFees.includes("'unknown_fail_closed'") && dexDiscovery.includes('complete_0x_explicit_fee_economic_treatment'));
check('DEX flash fee is no longer mislabeled as exchange fee', dexDiscovery.includes('feeUsd: null') && !dexDiscovery.includes('feeUsd: prepared.flashLoanFeeUsd'));
check('existing profitability wiring installs frontier after economic transformation subscription', admission.indexOf('ensureEconomicTransformationWiring();') >= 0 && admission.indexOf('ensureBpsFrontierWave3Wiring();') > admission.indexOf('ensureEconomicTransformationWiring();'));
check('existing canonical executor remains the hot-path authority', admission.includes("hotPathExecutionAuthority: 'canonical_strategy_executor_only'"));
check('BPS frontier synthetic savings remain forbidden', admission.includes('bpsFrontierSyntheticSavingsAllowed: false'));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`bps-frontier-wave3 verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[bps-frontier-wave3] PASS: keyless Lighter benchmarking plus contemporaneous exact-notional net-outcome SOR and explicit 0x fee attribution are consolidated under canonical BPS truth; embedded quote fees are not double-subtracted and no synthetic savings, personal funding, collateral fallback, or independent execution authority are admitted');
