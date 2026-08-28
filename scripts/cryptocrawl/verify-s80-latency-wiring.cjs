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
const requireOrder = (source, first, second, label) => {
  const a = source.indexOf(first);
  const b = source.indexOf(second);
  if (a < 0 || b < 0 || a >= b) failures.push(`${label}: expected ${JSON.stringify(first)} before ${JSON.stringify(second)}`);
};

const harness = read('server/services/cryptocrawl/runtime/end-to-end-latency-harness.ts');
const discovery = read('server/services/cryptocrawl/integration/discovery-latency-instrumentation.ts');
const cryptara = read('server/services/cryptocrawl/integration/cryptara-latency-instrumentation.ts');
const execution = read('server/services/cryptocrawl/integration/execution-latency-instrumentation.ts');
const universe = read('server/services/cryptocrawl/discovery/market-universe-controller.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const evolution = read('server/services/cryptocrawl/evolution/measured-execution-feedback.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Harness truth contract.
requireText(harness, 'process.hrtime.bigint()', 'monotonic high-resolution timing');
for (const stage of [
  'ingest', 'normalize', 'candidate', 'deterministic_economics', 'ml_advisory', 'mc_cache',
  'governance_risk', 'resource_lease', 'submit', 'exchange_rpc_ack', 'terminal_settlement', 'learning_enqueue',
]) requireText(harness, `'${stage}'`, `harness stage ${stage}`);
for (const kind of ['queue', 'compute', 'network']) requireText(harness, `'${kind}'`, `harness work kind ${kind}`);
for (const percentile of ['p50Ms', 'p95Ms', 'p99Ms', 'maxMs']) requireText(harness, percentile, `distribution ${percentile}`);
for (const outcome of ['timeouts', 'cancels', 'retries', 'errors']) requireText(harness, outcome, `outcome counter ${outcome}`);
requireText(harness, 'monitorEventLoopDelay', 'event-loop delay telemetry');
requireText(harness, 'PerformanceObserver', 'GC telemetry');
requireText(harness, 'process.memoryUsage()', 'memory telemetry');
requireText(harness, "authority: 'telemetry_only'", 'telemetry-only authority declaration');
requireText(harness, 'executionAuthority: false', 'no execution authority');
requireText(harness, "status: enough ? 'measured_baseline' : 'insufficient_samples'", 'SLO requires measured history');
requireText(harness, 'syntheticBenchmarkAuthority: false', 'synthetic benchmark is non-authoritative');
requireText(harness, 'hfturboMockLatencyAuthority: false', 'HFTurbo mock latency is non-authoritative');
forbidText(harness, 'Math.random', 'harness cannot fabricate samples');

// Front-half measured discovery stages.
requireText(discovery, "startSpan('ingest', 'network'", 'market-data ingestion timing');
requireText(discovery, 'marketDataProviders.discoverUniverse', 'ingest wraps canonical provider boundary');
requireText(discovery, "startSpan('candidate', 'compute'", 'candidate registration timing');
requireText(discovery, 'measuredCandidateRegistry.record', 'candidate timing wraps canonical registry');
requireText(discovery, "startSpan('deterministic_economics', 'network'", 'end-to-end verifier timing');
requireText(discovery, 'arbitrageVerifier.evaluateOnce', 'deterministic timing wraps canonical verifier');
requireText(discovery, 'composite_live_provider_wait_plus_all_in_economics', 'composite verifier timing semantics are explicit');
requireText(discovery, "authority: 'telemetry_only'", 'discovery wrappers telemetry-only');
requireText(discovery, 'calculationAuthorityChanged: false', 'discovery wrappers cannot replace calculations');
forbidText(discovery, 'executeVerifiedArbitragePlan', 'discovery instrumentation cannot invoke execution');
forbidText(discovery, 'Math.random', 'discovery instrumentation cannot fabricate timing/evidence');

requireText(universe, "startSpan('normalize', 'compute'", 'measured universe normalization timing');
requireText(universe, 'canonicalizeCexSymbol', 'normalize span surrounds canonicalization path');
requireText(universe, 'isUsefulArbitrageSymbol', 'normalize span surrounds symbol filtering path');

// Cryptara MC and advisory must be distinct, non-overloaded timing boundaries.
requireText(cryptara, "startSpan('mc_cache', 'compute'", 'Monte Carlo timing');
requireText(cryptara, 'runMonteCarloSimulation', 'MC wrapper uses existing public calculation authority');
requireText(cryptara, "startSpan('ml_advisory', 'compute'", 'advisory timing');
requireText(cryptara, 'recordOpportunityObservation', 'advisory wrapper measures post-MC assessment calculation');
requireText(cryptara, 'calculationAuthorityChanged: false', 'Cryptara timing cannot replace calculation authority');
forbidText(cryptara, 'Math.random', 'Cryptara timing cannot fabricate results');

// Late execution stages already present in canonical lifecycle.
requireText(scheduler, "'governance_risk'", 'governance/risk timing');
requireText(scheduler, "'resource_lease'", 'resource lease timing');
requireText(scheduler, "'terminal_settlement'", 'terminal settlement timing');
requireText(evolution, "startSpan('learning_enqueue'", 'learning enqueue timing');

// Submit + exchange ACK use nested real spans, not synthetic duplicate values.
requireText(execution, "startSpan('submit', 'network'", 'canonical adapter submit timing');
requireText(execution, 'adapter.submit = instrumentedSubmit', 'submit timing wraps canonical adapter method');
requireText(execution, "startSpan('exchange_rpc_ack', 'network'", 'authenticated exchange ACK timing');
requireText(execution, "url.pathname === '/0/private/AddOrder'", 'Kraken exact order-create ACK boundary');
requireText(execution, "url.pathname === '/api/v5/trade/order'", 'OKX exact order-create ACK boundary');
requireText(execution, "url.pathname === '/api/v3/brokerage/orders'", 'Coinbase exact order-create ACK boundary');
requireText(execution, 'nestedSpanSemantics: true', 'submit/ACK nested semantics declared');
requireText(execution, 'exactOrderCreationHttpOnly: true', 'fetch instrumentation is narrowly scoped');
requireText(execution, "authority: 'telemetry_only'", 'execution latency wrappers telemetry-only');
requireText(execution, 'settlementAuthorityChanged: false', 'latency instrumentation cannot replace settlement authority');
forbidText(execution, 'executeVerifiedArbitragePlan', 'latency wrappers cannot invoke execution directly');
forbidText(execution, 'process.env.NO_EXECUTION =', 'latency wrappers cannot alter execution posture');
forbidText(execution, 'Math.random', 'latency wrappers cannot fabricate data');

// Runtime install order: all wrappers exist before the measured graph starts.
requireText(runtime, 'ensureCryptaraLatencyInstrumentation()', 'runtime installs Cryptara timing');
requireText(runtime, 'ensureDiscoveryLatencyInstrumentation()', 'runtime installs discovery timing');
requireText(runtime, 'ensureExecutionLatencyInstrumentation()', 'runtime installs execution timing');
requireOrder(runtime, 'ensureCryptaraLatencyInstrumentation()', 'measuredOpportunityGraph.start()', 'Cryptara timing installed before graph start');
requireOrder(runtime, 'ensureDiscoveryLatencyInstrumentation()', 'measuredOpportunityGraph.start()', 'discovery timing installed before graph start');
requireOrder(runtime, 'ensureExecutionLatencyInstrumentation()', 'measuredOpportunityGraph.start()', 'execution timing installed before graph start');
requireText(runtime, "latencyInstrumentationAuthority: 'telemetry_only'", 'runtime declares timing authority');

if (failures.length) {
  console.error('[s80-latency-wiring] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[s80-latency-wiring] PASS — all measured S-80 stages are wired to existing canonical boundaries without changing execution, settlement, economics, or advisory authority');
