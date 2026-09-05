const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const frontier = read('server/services/cryptocrawl/integration/bps-frontier-wave3-wiring.ts');
const admission = read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('Lighter official public funding endpoint is used', frontier.includes("https://mainnet.zklighter.elliot.ai/api/v1/funding-rates"));
check('Lighter discovery introduces no API key requirement', !/LIGHTER_[A-Z_]*API_KEY|LIGHTER_API_KEY/.test(frontier));
check('Lighter observation is never executable authority', frontier.includes("executableCapability: false") && frontier.includes("execution_promotion:false"));
check('Lighter account tier fee is unknown until measured', frontier.includes('feeUsd: null') && frontier.includes('lighter_exact_account_tier_fee_evidence'));
check('Lighter hidden latency is never assigned synthetic BPS', frontier.includes('lighter_measured_execution_latency_cost') && frontier.includes('hiddenLatencyBpsAssumed: false'));
check('Lighter system-owned collateral provenance is required', frontier.includes('lighter_system_owned_margin_collateral_provenance') && frontier.includes('personal_collateral_allowed:false'));
check('smart-order frontier uses canonical measured all-in BPS', frontier.includes('candidate.canonicalBps.allInCostBps'));
check('smart-order frontier compares exact like-sized notionals', frontier.includes('candidate.canonicalBps.notionalUsd') && frontier.includes('notionalUsd.toFixed(2)') && frontier.includes("`${assets.join('/')}:${chains}:${notionalUsd.toFixed(2)}`"));
check('reported savings are measured route differences only', frontier.includes('runnerUp.allInCostBps - winner.allInCostBps'));
check('frontier cannot manufacture same-route savings', frontier.includes('Multiple snapshots of the same exact route must not manufacture'));
check('frontier advertises no independent execution authority', frontier.includes("executionAuthority: false") && !frontier.includes('executionAuthority: true'));
check('frontier does not import a strategy executor', !/centralizedExchangeExecutor|zeroCapitalEngine|executePrepared|submitOrder/.test(frontier));
check('direct-vs-aggregator credit requires canonical measurement', frontier.includes("directVsAggregatorPolicy: 'only_measured_canonical_costs_may_report_savings'"));
check('Uniswap v4 cannot receive unmeasured BPS credit', frontier.includes('requires_exact_pool_quote_before_economic_credit'));
check('intent/solver surfaces cannot bypass zero-personal-resource proof', frontier.includes('zero_personal_resource_proof_before_admission'));
check('MEV/private builder reductions require terminal realized evidence', frontier.includes('terminal_realized_evidence_before_bps_credit'));
check('existing profitability wiring installs frontier after economic transformation subscription', admission.indexOf('ensureEconomicTransformationWiring();') >= 0 && admission.indexOf('ensureBpsFrontierWave3Wiring();') > admission.indexOf('ensureEconomicTransformationWiring();'));
check('existing canonical executor remains the hot-path authority', admission.includes("hotPathExecutionAuthority: 'canonical_strategy_executor_only'"));
check('BPS frontier synthetic savings remain forbidden', admission.includes('bpsFrontierSyntheticSavingsAllowed: false'));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`bps-frontier-wave3 verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[bps-frontier-wave3] keyless Lighter discovery and like-notional measured total-cost route frontier are additive BPS research surfaces only; no synthetic savings, personal funding, collateral fallback, or independent execution authority admitted');
