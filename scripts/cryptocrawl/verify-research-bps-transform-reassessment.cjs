const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(condition, message) { if (!condition) throw new Error(`[research-bps-transform-reassessment] ${message}`); }
function has(text, needle, message) { must(text.includes(needle), message); }

const tactics = read('server/services/cryptocrawl/optimization/research-bps-execution-tactics.ts');
const wiring = read('server/services/cryptocrawl/integration/economic-transformation-wiring.ts');
const economic = read('server/services/cryptocrawl/optimization/economic-transformation-engine.ts');
const residual = read('server/services/cryptocrawl/discovery/cex-residual-replan.ts');
const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
const mc = read('server/services/cryptocrawl/execution/adapters/monte-carlo-profitability.ts');

const tacticRows = [...tactics.matchAll(/\{ id: (\d+), key: '[^']+'/g)];
must(tacticRows.length === 25, `expected exactly 25 new research tactics, found ${tacticRows.length}`);
must(new Set(tacticRows.map(match => Number(match[1]))).size === 25, 'research tactic ids must be unique');
for (let id = 1; id <= 25; id += 1) must(tacticRows.some(match => Number(match[1]) === id), `missing research tactic ${id}`);

has(tactics, "import { quantiComp", 'Quanti Comp must execute tactic-search compute');
has(tactics, 'runProfitabilityMonteCarlo', 'Monte Carlo must score tactic uncertainty');
has(tactics, 'advisoryOnly: true', 'negative/near-miss Monte Carlo must remain scheduling-only');
has(tactics, "executionAuthority: false", 'research tactics must not acquire execution authority');
has(tactics, "syntheticEconomicsAllowed: false", 'research tactics must not manufacture profitability');
has(tactics, "driver === 'exchange_fees'", 'fee-dominated cases must be explicitly distinguished');
has(tactics, 'Percentage fees are not improved by blindly shrinking size', 'percentage-fee gap must not be disguised by notional shrinkage');

has(wiring, 'installObservedCandidateRevalidationHook', 'observed CEX candidates must be intercepted for potential recheck');
has(wiring, 'queueAnomalyRevalidation(recorded)', 'raw positive observations must trigger reassessment');
has(wiring, 'getRawCrossVenueEdge(candidate)', 'anomaly trigger must use measured cross-venue quote evidence');
has(wiring, 'measuredOpportunityGraph.revalidateSymbols([symbol])', 'anomaly and transformation paths must reacquire canonical exact-symbol evidence');
has(wiring, 'attempts', 'anomaly reassessment must support bounded retries');
has(wiring, 'cryptara_and_monte_carlo_if_deterministic_positive', 'critical evidence path must include Cryptara/Monte Carlo after deterministic positivity');
has(wiring, 'queueOperationalTransformation', 'portfolio advice must be converted into operational work');
has(wiring, 'runResearchBpsQuantiMonteCarlo', 'operational transformations must consume Quanti Comp Monte Carlo ranking');
has(wiring, 'queueCexResidualReplan', 'non-linear execution-cost transformations must generate exact smaller-notional fresh replans');
has(wiring, 'queueCexNearMissRecovery', 'CEX four-mode near misses must be promoted from logging to fresh recovery work');
has(wiring, 'percentageFeeGapNotPretendedAwayByShrinkingSize: true', 'fee-dominated BPS must not be cosmetically reduced');
has(wiring, 'executionAuthority: false', 'transformation wiring must not execute directly');

has(economic, "authority: 'optimization_advisory_only'", 'original transformation advice remains advisory');
has(residual, 'fresh_arbitrage_verifier', 'residual replan must use fresh canonical verifier economics');
has(residual, 'authenticated_fee_evidence', 'residual replan must retain authenticated fee authority');
has(residual, 'fresh_depth_evidence', 'residual replan must retain measured depth');
has(residual, 'cryptara.assessOpportunity', 'residual replan must retain Cryptara assessment');
has(graph, 'positive_observation_revalidation', 'canonical graph must retain targeted positive revalidation mode');
has(mc, 'deterministic all-in net profit must be positive first', 'authoritative Monte Carlo admission must retain deterministic-positive-first rule');

must(!wiring.includes('centralizedExchangeExecutor'), 'transformation wiring must not submit CEX orders itself');
must(!wiring.includes('executeVerifiedArbitragePlan'), 'transformation wiring must not bypass canonical execution scheduler');
must(!tactics.includes('process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION ='), 'research tactics must not enable live execution posture');

console.log('[research-bps-transform-reassessment] PASS: 25 new tactics, Quanti Comp + Monte Carlo planning, bounded anomaly reacquisition, operational transform revalidation, exact residual replans, and canonical execution authority retained');
