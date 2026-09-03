const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(condition, message) { if (!condition) throw new Error(`[research-bps-transform-reassessment] ${message}`); }
function has(text, needle, message) { must(text.includes(needle), message); }

const tactics = read('server/services/cryptocrawl/optimization/research-bps-execution-tactics.ts');
const superEngine = read('server/services/cryptocrawl/optimization/bps-reduction-super-engine.ts');
const mesh = read('server/services/cryptocrawl/integration/bps-compression-mesh.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const wiring = read('server/services/cryptocrawl/integration/economic-transformation-wiring.ts');
const economic = read('server/services/cryptocrawl/optimization/economic-transformation-engine.ts');
const residual = read('server/services/cryptocrawl/discovery/cex-residual-replan.ts');
const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
const mc = read('server/services/cryptocrawl/execution/adapters/monte-carlo-profitability.ts');
const packageJson = read('package.json');

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

has(superEngine, 'practicalAnomalyPolicy', 'super engine must convert anomaly research into bounded practical retry timing');
has(superEngine, "edge > 100) return { attempts: 3, delaysMs: [0, 50, 100]", 'large anomalies must receive immediate three-pass reacquisition');
has(superEngine, "edge >= 50) return { attempts: 2, delaysMs: [50, 200]", 'medium anomalies must receive bounded two-pass reacquisition');
has(superEngine, "attempts: 1, delaysMs: [100]", 'small anomalies must receive one delayed confirmation');
has(superEngine, 'venueWeights(candidate', 'super engine must score measured venue consensus quality');
has(superEngine, 'learnedHalfLifeMs(candidate', 'super engine must learn/estimate symbol edge half-life');
has(superEngine, 'Math.min(edge / 3, 5, expectedDecayBps / 2)', 'marketable-limit concession advisory must retain the hard 5 BPS cap');
has(superEngine, "availableExecutionModes: candidate.topology === 'CEX_CEX'", 'CEX super plan must evaluate TT/MT/TM/MM surfaces');
has(superEngine, 'buildAttribution(candidate)', 'BPS attribution ledger must decompose measured costs');
has(superEngine, "if (value === null || value === undefined || typeof value === 'boolean') return null", 'unknown economics must not be coerced into fabricated zero BPS');
has(superEngine, "if (typeof value === 'string' && value.trim() === '') return null", 'blank economics must remain unknown');
has(packageJson, 'node scripts/cryptocrawl/verify-research-bps-transform-reassessment.cjs', 'BPS verifier must be an unavoidable prebuild gate');
has(superEngine, "key: 'maker_latency_control'", 'maker/latency tactic synergy bundle must exist');
has(superEngine, "key: 'size_route_settlement'", 'size/routing/settlement tactic synergy bundle must exist');
has(superEngine, "key: 'near_miss_learning'", 'near-miss learning tactic synergy bundle must exist');
has(superEngine, 'updateRealizedGovernor(candidate)', 'realized BPS must feed the closed-loop governor');
has(superEngine, 'accuracy >= 0.90', 'high realized prediction accuracy must earn bounded resource reinforcement');
has(superEngine, 'accuracy < 0.70', 'low realized prediction accuracy must reduce bounded resource allocation');
has(superEngine, 'allocationMultiplier', 'closed-loop governor must expose bounded tactic allocation');
has(superEngine, "hardwareAccelerationPolicy: 'quanti_comp_backend_eligible_only'", 'hardware/backend acceleration must remain Quanti Comp controlled');
has(superEngine, "authority: 'adaptive_bps_measurement_revalidation_and_scheduling_only'", 'super engine authority must remain measurement/revalidation/scheduling only');
has(superEngine, 'executionAuthority: false', 'super engine must not acquire execution authority');
has(superEngine, 'syntheticEconomicsAllowed: false', 'super engine must not manufacture profitability');

has(mesh, "if (value === null || value === undefined || typeof value === 'boolean') return null", 'BPS compression mesh must preserve null/boolean economics as unknown');
has(mesh, "if (typeof value === 'string' && value.trim() === '') return null", 'BPS compression mesh must preserve blank economics as unknown');
has(economic, "if (value === null || value === undefined || typeof value === 'boolean') return null", 'transformation engine must preserve null/boolean economics as unknown');
has(economic, "if (typeof value === 'string' && value.trim() === '') return null", 'transformation engine must preserve blank economics as unknown');
has(scheduler, 'getBpsReductionSuperEngineSnapshot', 'canonical hot-lane scheduler must consume Super Engine decay learning');
has(scheduler, 'bpsDecayUrgencyFactor', 'canonical hot-lane scheduler must apply bounded learned decay urgency');
has(scheduler, 'return 1 + urgency * 0.5', 'BPS scheduling overlay must be boost-only and bounded');
has(scheduler, 'bpsSuperEngineExecutionAuthority: false', 'Super Engine scheduling integration must retain zero execution authority');

has(wiring, 'installObservedCandidateRevalidationHook', 'observed CEX candidates must be intercepted for potential recheck');
has(wiring, 'queueAnomalyRevalidation(recorded)', 'raw positive observations must trigger reassessment');
has(wiring, 'getRawCrossVenueEdge(candidate)', 'anomaly trigger must use measured cross-venue quote evidence');
has(wiring, 'buildBpsReductionSuperPlan', 'economic transformation wiring must consume the BPS super engine');
has(wiring, 'recordBpsCandidateAttribution(recorded)', 'registry records must feed BPS attribution');
has(wiring, 'recordBpsCandidateAttribution(updated)', 'terminal status updates must feed realized BPS learning');
has(wiring, 'recordBpsRevalidationOutcome(superPlan, cycle)', 'anomaly canonical results must train revalidation scheduling');
has(wiring, 'recordBpsRevalidationOutcome(superPlan, canonicalCycle)', 'transformation canonical results must train revalidation scheduling');
has(wiring, 'effectivePriorityScore', 'super-engine priority must alter actual recovery scheduling');
has(wiring, 'monteCarloSearchMultiplier', 'super-engine allocation must alter Quanti/Monte Carlo search effort');
has(wiring, 'superPlan.residualNotionalFractions', 'super-engine nonlinear notional probes must reach the existing residual replanner');
has(wiring, 'fraction > 0 && fraction < 1', 'residual replans must remain true smaller-size probes');
has(wiring, 'measuredOpportunityGraph.revalidateSymbols([symbol])', 'anomaly and transformation paths must reacquire canonical exact-symbol evidence');
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
must(!superEngine.includes('process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION ='), 'super engine must not enable live execution posture');

console.log('[research-bps-transform-reassessment] PASS: 25 tactics plus practical adaptive super engine, attribution ledger, synergy bundles, realized-outcome governor, Quanti/Monte Carlo scheduling, bounded anomaly reacquisition, canonical transform revalidation, exact residual replans, canonical hot-lane decay scheduling, unknown-economics preservation, and canonical execution authority retained');