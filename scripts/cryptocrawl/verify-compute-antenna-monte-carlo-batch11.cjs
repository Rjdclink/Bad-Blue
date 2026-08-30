const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = {
  reactor: 'server/reactor/computationalReactor.ts',
  wiring: 'server/services/cryptocrawl/integration/computational-reactor-wiring.ts',
  antenna: 'server/services/cryptocrawl/integration/order-book-evolution-wiring.ts',
  prefetch: 'server/services/cryptocrawl/integration/cryptara-predictive-prefetch-wiring.ts',
  canonical: 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts',
  venue: 'server/services/cryptocrawl/discovery/venue-capability-registry.ts',
};

const source = {};
for (const [key, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`[compute-antenna-monte-carlo-batch11] missing ${relative}`);
  source[key] = fs.readFileSync(absolute, 'utf8');
}

const required = [
  ['reactor', 'process.cpuUsage()', 'measured CPU accounting'],
  ['reactor', 'process.hrtime.bigint()', 'measured CPU time denominator'],
  ['reactor', 'REACTOR_QUEUE_CAPACITY_REACHED', 'bounded queue backpressure'],
  ['reactor', 'dedupeKeys', 'duplicate-work collapse'],
  ['reactor', "typeof scorer !== 'function'", 'real Monte Carlo scorer requirement'],
  ['reactor', 'await scorer(midpoint)', 'measured baseline score'],
  ['reactor', 'Promise.all(candidates.map', 'bounded concurrent Monte Carlo scoring'],
  ['reactor', 'syntheticImprovement: false', 'no fabricated optimizer improvement'],
  ['reactor', "this.heatMonitor.throttleLevel === 'heavy'", 'compute-pressure stop'],
  ['reactor', '2 ** (job.retryCount - 1)', 'bounded exponential retry'],
  ['reactor', "if (start === end) return false", 'explicitly disabled equal maintenance window'],
  ['wiring', "'cryptocrawl_search_allocation'", 'live CryptoCrawler search-allocation calibration target'],
  ['wiring', 'getCexFourModeSnapshot()', 'measured CEX economics input'],
  ['wiring', 'getProviderQualityAuctionSnapshot()', 'Antenna provider-quality input'],
  ['wiring', 'getCryptaraSovereignCortexSnapshot()', 'Cryptara priority input'],
  ['wiring', 'computationalReactor.scheduleMonteCarloRun(', 'reactor Monte Carlo scheduled from runtime evidence'],
  ['wiring', 'getComputationalSearchPlan()', 'measured compute plan exposed to consumers'],
  ['wiring', "authority: 'measured_compute_search_scheduling_only'", 'search-only authority boundary'],
  ['wiring', 'executionAuthority: false', 'reactor cannot authorize execution'],
  ['antenna', 'getComputationalSearchPlan()', 'Antenna consumes compute plan'],
  ['antenna', 'computeBreadth', 'compute plan changes bounded scan breadth'],
  ['antenna', 'computeInterval', 'compute plan changes bounded scan cadence'],
  ['antenna', 'symbols.flatMap(symbol => venues.map', 'executable-venue work interleaved per symbol'],
  ['antenna', 'Promise.allSettled', 'bounded simultaneous provider work'],
  ['antenna', 'getProviderQualityAuctionSnapshot()', 'provider quality remains measured'],
  ['antenna', 'allExecutableVenuesStillObservedSimultaneously: true', 'provider auction cannot suppress executable venue observation'],
  ['antenna', 'executionAuthority: false', 'Antenna remains advisory'],
  ['prefetch', "bid.venue === 'kraken' || bid.venue === 'okx'", 'stream-backed prefetch venue containment'],
  ['prefetch', "const fallback: CexStreamVenue[] = ['kraken', 'okx']", 'both stream-backed venues preserved under provider ranking'],
  ['prefetch', "getHeatMonitor().throttleLevel === 'heavy'", 'prefetch stops under heavy compute pressure'],
  ['prefetch', 'universeIntervalMs()', 'market-universe prefetch bounded'],
  ['prefetch', 'inFlight.has(normalized)', 'per-symbol prefetch duplicate collapse'],
  ['prefetch', 'executionAuthority: false', 'prefetch cannot authorize execution'],
  ['canonical', "import { ensureComputationalReactorWiring }", 'reactor canonical import'],
  ['canonical', 'ensureComputationalReactorWiring();', 'reactor canonical installation'],
  ['canonical', "executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'", 'strict positive economics preserved'],
  ['canonical', 'cexHybridExecutionAuthority: false', 'hybrid execution remains disabled'],
  ['canonical', 'computationalReactorExecutionAuthority: false', 'canonical reactor authority boundary'],
  ['canonical', 'alchemyPaidPendingStreamDefault: false', 'paid Alchemy pending stream remains off by default'],
  ['venue', "getActiveExecutableQuoteVenues(): Array<'coinbase' | 'kraken' | 'okx'>", 'active executable CEX topology remains limited to implemented Coinbase/Kraken/OKX paths'],
  ['venue', 'settlementVerification: true', 'active executable venues retain settlement verification capability'],
];

for (const [fileKey, token, name] of required) {
  if (!source[fileKey].includes(token)) throw new Error(`[compute-antenna-monte-carlo-batch11] missing invariant: ${name}`);
}

const forbidden = [
  ['reactor', 'this.heatMonitor.cpuUsage = Math.min(100, Math.random() * 30 + 20)', 'simulated CPU pressure'],
  ['reactor', 'const improvement = Math.random() * 2 - 0.5', 'fabricated Monte Carlo improvement'],
  ['canonical', 'cexHybridExecutionAuthority: true', 'unverified hybrid execution authority'],
  ['canonical', 'alchemyPaidPendingStreamDefault: true', 'paid pending stream default-on'],
];
for (const [fileKey, token, name] of forbidden) {
  if (source[fileKey].includes(token)) throw new Error(`[compute-antenna-monte-carlo-batch11] forbidden regression: ${name}`);
}

console.log('[compute-antenna-monte-carlo-batch11] PASS: measured compute pressure, real scorer Monte Carlo, adaptive Antenna scheduling, bounded stream prefetch, implemented venue containment, and execution-authority boundaries preserved');
