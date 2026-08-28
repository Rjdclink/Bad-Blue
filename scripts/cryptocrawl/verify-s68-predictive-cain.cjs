const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const req = (s,n,l) => { if (!s.includes(n)) failures.push(`${l}: missing ${JSON.stringify(n)}`); };
const forbid = (s,n,l) => { if (s.includes(n)) failures.push(`${l}: forbidden ${JSON.stringify(n)}`); };

const engine = read('server/services/cryptocrawl/intelligence/predictive-cain-preparation.ts');
const wiring = read('server/services/cryptocrawl/integration/predictive-cain-wiring.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

for (const kind of ['spread_formation','funding_dislocation','liquidity_deterioration','liquidation_window']) req(engine, `'${kind}'`, `Predictive Cain models ${kind}`);
req(engine, "'lux_predicted_preparation_stream'", 'predictions enter a separate Lux preparation stream');
req(engine, 'authoritative: false', 'prediction records are explicitly non-authoritative');
req(engine, 'deterministicPositive: false', 'prediction cannot claim deterministic-positive state');
req(engine, 'executable: false', 'prediction cannot claim executable state');
req(engine, 'falsePositive', 'false positives are measured');
req(engine, 'falseNegative', 'false negatives are measured');
req(engine, 'precision:', 'precision is measured by regime');
req(engine, 'recall:', 'recall is measured by regime');
req(engine, 'model.weights', 'probabilities learn from measured feature outcomes');
req(engine, 'candidate.rawQuotes', 'model features include measured quote evidence');
req(engine, 'candidate.quoteAgeMs', 'model features include explicit timestamp/freshness evidence');
req(engine, 'candidate.provenance', 'prediction preserves source provenance');

req(wiring, 'PREDICTIVE_CAIN_PREP_BUDGET_PER_MINUTE', 'preparation has a bounded resource budget');
req(wiring, 'marketDataProviders.discoverUniverse()', 'predictions may warm market data');
req(wiring, 'cexOrderBookStreams.getQuote', 'predictions may prefetch CEX books');
req(wiring, "hedgedRpcRead<string>(chain, 'eth_blockNumber'", 'predictions may warm validated RPC providers');
req(wiring, 'Promise.allSettled(tasks)', 'preparation failures cannot fail the canonical opportunity flow');
req(wiring, 'executionAuthority: false', 'preparation wiring cannot execute');
req(wiring, 'deterministicPositiveAuthority: false', 'preparation wiring cannot establish positive economics');
req(wiring, 'verifiedOpportunitySuppressionAllowed: false', 'prediction cannot suppress verified positives');

forbid(engine, 'executeVerifiedArbitragePlan', 'Predictive Cain cannot execute');
forbid(engine, 'canonicalExecutionScheduler', 'Predictive Cain cannot schedule execution');
forbid(engine, "updateStatus(", 'Predictive Cain cannot mutate measured candidate eligibility');
forbid(wiring, "updateStatus(", 'Predictive wiring cannot mutate measured candidate eligibility');
forbid(wiring, 'stageManager.', 'Predictive wiring cannot become governance authority');
req(runtime, 'ensurePredictiveCainWiring();', 'canonical runtime installs advisory prediction preparation');
req(runtime, 'predictiveCainExecutionAuthority: false', 'runtime declares no prediction execution authority');

if (failures.length) {
  console.error('[s68-predictive-cain] FAIL');
  failures.forEach(f => console.error(` - ${f}`));
  process.exit(1);
}
console.log('[s68-predictive-cain] PASS — predictions improve preparation latency while verified economics/governance/execution remain authoritative');
