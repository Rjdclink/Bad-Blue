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
const requireOrder = (source, needles, label) => {
  const positions = needles.map(needle => source.indexOf(needle));
  if (positions.some(position => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    failures.push(`${label}: expected order ${needles.map(value => JSON.stringify(value)).join(' -> ')}`);
  }
};

const budget = read('server/services/cryptocrawl/intelligence/zerox-request-budget.ts');
const marketData = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
const observability = read('server/services/cryptocrawl/integration/zerox-budget-observability.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

requireText(budget, "authority: 'local_provider_admission_only'", '0x budget authority is explicitly local-only');
requireText(budget, 'executionAuthority: false', '0x budget cannot authorize trades');
requireText(budget, 'providerRateLimitClaim: false', 'local budget cannot claim provider quota truth');
requireText(budget, 'ZEROX_LOCAL_REQUEST_BUDGET', 'local total request budget is configurable');
requireText(budget, 'ZEROX_LOCAL_EXECUTION_RESERVE', 'execution request reserve is explicit');
requireText(budget, 'ZEROX_LOCAL_MAX_CONCURRENT', 'local concurrency budget is configurable');
requireText(budget, 'ZEROX_LOCAL_EXECUTION_CONCURRENCY_RESERVE', 'execution concurrency reserve is explicit');
requireText(budget, 'counts.discovery >= discoveryRequestBudget', 'discovery cannot consume execution request reserve');
requireText(budget, 'this.activeDiscovery >= discoveryConcurrentBudget', 'discovery cannot consume execution concurrency reserve');
requireText(budget, 'counts.total >= this.totalRequestBudget', 'all purposes remain bounded by total request envelope');
requireText(budget, 'activeTotal >= this.maxConcurrentRequests', 'all purposes remain bounded by total concurrency envelope');
requireText(budget, 'discoveryAdmissionsBlocked', 'discovery budget pressure is observable');
requireText(budget, 'executionAdmissionsBlocked', 'execution budget pressure is observable');
forbidText(budget, 'executeVerifiedArbitragePlan', 'request budget cannot invoke execution');
forbidText(budget, 'stageManager', 'request budget cannot mutate governance');
forbidText(budget, 'netProfitUsd', 'request budget cannot redefine trade economics');

requireText(marketData, "| 'throttled' |", 'local admission pressure is distinguishable from provider failure');
requireText(marketData, 'zeroXRequestBudget.tryAcquire(policy.purpose)', 'fresh 0x network calls pass purpose-aware admission');
requireText(marketData, 'admission.release()', '0x concurrency admission is always released');
requireText(marketData, 'getZeroXRequestBudgetSnapshot()', 'market-data authority exposes local budget telemetry');
requireOrder(
  marketData,
  ['const cached = this.quoteCache.get(key)', 'const existing = this.inFlight.get(key)', 'zeroXRequestBudget.tryAcquire(policy.purpose)', 'fetchJsonWithRetry<any>'],
  'cache and in-flight reuse must occur before local budget consumption',
);
requireOrder(
  marketData,
  ['zeroXRequestBudget.tryAcquire(policy.purpose)', 'fetchJsonWithRetry<any>'],
  'local admission must occur before fresh outbound 0x request',
);

requireText(observability, 'getZeroXRequestBudgetSnapshot()', 'runtime telemetry reads the canonical local budget snapshot');
requireText(observability, 'providerQuotaAuthoritative: false', 'telemetry cannot promote local limits to provider truth');
requireText(observability, 'tradingAuthority: false', 'budget telemetry cannot authorize trading');
requireText(observability, "process.env.NO_INTERVALS === 'true'", 'preflight/no-interval environments do not start budget telemetry timers');
requireText(runtime, 'ensureZeroXBudgetObservability()', 'canonical runtime installs local budget telemetry');
requireText(runtime, "zeroXRequestAdmission: 'purpose_aware_local_budget_with_execution_reserve'", 'runtime declares purpose-aware 0x admission');
requireText(runtime, 'zeroXProviderRateLimitClaim: false', 'runtime refuses provider quota claims');
requireText(runtime, 'zeroXRequestAdmissionExecutionAuthority: false', 'runtime declares no execution authority for request admission');

if (failures.length > 0) {
  console.error('[zerox-request-budget] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[zerox-request-budget] PASS — fresh 0x requests are locally bounded after cache/dedupe, discovery preserves an execution reserve, provider quota truth is not invented, and budget telemetry has no trading authority');
