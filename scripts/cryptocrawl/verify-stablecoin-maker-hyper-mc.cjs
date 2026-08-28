const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`FAIL ${label}: missing ${needle}`);
}
function mustNot(source, needle, label) {
  if (source.includes(needle)) throw new Error(`FAIL ${label}: forbidden ${needle}`);
}

const strategy = read('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts');
const adapters = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');
const executionWiring = read('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts');
const profitWiring = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');
const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
const cryptara = read('server/services/cryptocrawl/integration/cryptara-bootstrap-wiring.ts');
const hyper = read('server/services/cryptocrawl/validation/monte-carlo-hyper-engine.ts');

must(strategy, "new Set(['USDGUSDT', 'USDCUSDT', 'DAIUSDT', 'RLUSDUSDT'])", 'stablecoin allowlist');
must(strategy, "evidence.source === 'configured_override'", 'authenticated maker fee rejection');
must(strategy, "takerFallbackAllowed: false", 'no taker fallback contract');
must(strategy, 'Math.min(5_000', 'canary hard ceiling');
must(strategy, 'Math.min(30_000', 'maker TTL hard ceiling');
must(strategy, "crossVenueCostModel: 'prepositioned_inventory'", 'prepositioned inventory model');

must(adapters, "oflags: 'post'", 'Kraken post-only');
must(adapters, "timeinforce: 'GTC'", 'Kraken resting order');
must(adapters, "ordType: 'post_only'", 'OKX post-only');
mustNot(adapters, "ordType: 'ioc'", 'maker adapter cannot submit OKX IOC');
mustNot(adapters, "timeinforce: 'IOC'", 'maker adapter cannot submit Kraken IOC');

must(executionWiring, 'if (!isStablecoinMakerPlan(plan)) return originalExecute(plan);', 'existing taker path preserved');
must(executionWiring, 'new CentralizedExchangeExecutor({', 'canonical executor reused');
must(executionWiring, 'settlementTimeoutMs: ttlMs', 'cancel-only TTL delegated to canonical settlement');

must(profitWiring, 'const takerPlan = await originalEvaluateOnce(request);', 'taker path remains first');
must(profitWiring, 'evaluateStablecoinMakerCandidate', 'maker recovery path wired');
must(profitWiring, 'ensureStablecoinMakerExecutionWiring();', 'maker executor installed');
must(profitWiring, 'cryptara_parallel_hyper_monte_carlo', 'Cryptara Hyper MC retained authority');

must(graph, 'await cryptara.assessOpportunity({', 'opportunity graph Cryptara assessment');
must(graph, "assessment.recommendation === 'consider'", 'Cryptara eligibility gate');
must(cryptara, 'runHyperMonteCarlo', 'Cryptara Hyper MC wiring');
must(cryptara, 'workersUsed: hyper.workersUsed', 'parallel worker evidence recorded');
must(hyper, "import { Worker } from 'node:worker_threads';", 'real worker-thread parallelism');
must(hyper, 'stoppedEarly', 'dynamic early-stop evidence');
must(hyper, 'deadlineAt:quoteDeadlineAt', 'quote deadline prevents simulation overrun');

console.log('PASS stablecoin maker + Cryptara parallel Hyper Monte Carlo wiring');
