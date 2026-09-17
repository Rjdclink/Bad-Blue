const assert = require('node:assert/strict');
const fs = require('node:fs');

const quoter = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');
const core = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');
const discovery = fs.readFileSync('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts', 'utf8');
const dynamic = fs.readFileSync('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts', 'utf8');
const providerEconomics = fs.readFileSync('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts', 'utf8');
const fairness = fs.readFileSync('server/services/cryptocrawl/execution/zero-capital-rescue-fairness.ts', 'utf8');
const overflowSchema = fs.readFileSync('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts', 'utf8');
const fairnessMigration = fs.readFileSync('server/migrations/059_cryptocrawler_zero_capital_rescue_fairness.sql', 'utf8');
const mesh = fs.readFileSync('server/services/cryptocrawl/integration/bps-compression-mesh.ts', 'utf8');
const executor = fs.readFileSync('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts', 'utf8');
const stageOneSpread = fs.readFileSync('server/services/cryptocrawl/integration/stage-one-spread-observability.ts', 'utf8');
const apeV4 = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts', 'utf8');
const receiverManager = fs.readFileSync('server/services/cryptocrawl/execution/adapters/sponsored-receiver-manager.ts', 'utf8');
const routeSplit = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-route-split-rescue-core.ts', 'utf8');
const providerWiring = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts', 'utf8');
const dualReceiver = fs.readFileSync('contracts/cryptocrawl/CryptocrawlAaveBalancerDualFlashLoanReceiver.sol', 'utf8');

// A non-responsive DEX eth_call must never pin the shared leg cache or prevent
// the recurring canonical zero-capital discovery cycle from scheduling again.
assert.match(quoter, /function withQuoteTimeout<T>/);
assert.match(quoter, /setTimeout\([\s\S]*quote deadline/);
assert.match(quoter, /timer\.unref\?\.\(\)/);
assert.match(quoter, /clearTimeout\(timer\)/);
assert.match(quoter, /const pending = withQuoteTimeout\([\s\S]*quoteLegUncached/);
assert.match(quoter, /providerQuotes\.set\(key, pending\)/);
assert.match(quoter, /if \(providerQuotes\.get\(key\) === pending\) providerQuotes\.delete\(key\)/);
assert.match(quoter, /const remainingMs = quoteDeadlineMs - elapsedMs/);
assert.match(quoter, /quoteLeg\(provider, route\.chain, leg, currentAmount, remainingMs\)/);
assert.match(quoter, /if \(error instanceof Error && error\.message\.includes\('quote deadline'\)\) return null/);

// First-pass evidence acquisition uses the canonical redundant RPC mesh.
assert.match(quoter, /multiProviderRpcManager\.execute\([\s\S]*'contract_calls'/);
assert.match(quoter, /rpcProvider => quoteLegAgainstProvider\(rpcProvider, chain, leg, amountIn\)/);

// Exact quote evidence is reused only inside the same canonical block. One logical
// provider-mesh block feed invalidates resident quote evidence event-by-event, and
// mesh-global singleflight collapses duplicate worker requests without narrowing
// any route/provider capability. The existing bounded size sweep remains one
// parallel application batch wave rather than serializing candidate sizes.
assert.match(quoter, /const blockScopedLegQuotes = new Map<string, BlockScopedLegQuote>\(\)/);
assert.match(quoter, /const inFlightMeshLegQuotes = new Map<string, Promise<BigNumber>>\(\)/);
assert.match(quoter, /function ensureQuoteBlockTracker\(chain: SupportedExecutionChain\): void/);
assert.match(quoter, /multiProviderRpcManager\.subscribe\(rpcChain, 'blocks'/);
assert.match(quoter, /clearBlockScopedLegQuotes\(rpcChain\)/);
assert.match(quoter, /const blockNumber = latestQuoteBlockByChain\.get\(rpcChain\)/);
assert.match(quoter, /cached && cached\.blockNumber === blockNumber/);
assert.match(quoter, /const singleflightKey = `\$\{blockNumber \?\? 'untracked'\}:\$\{key\}`/);
assert.match(quoter, /meshSingleflightJoins \+= 1/);
assert.match(quoter, /latestQuoteBlockByChain\.get\(rpcChain\) === blockNumber/);
assert.match(quoter, /const sizes = \[\.\.\.new Set\(routeNotionalCandidates\(route\)\)\]/);
assert.match(quoter, /routeBatchWaves \+= 1/);
assert.match(quoter, /capabilityReduction: false/);

// Stage One's visible ZERO_CAPITAL_ATOMIC spread is the canonical all-in NET BPS,
// never gross-first telemetry, and the strict > -10 BPS boundary is re-used here.
assert.match(stageOneSpread, /candidate\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(stageOneSpread, /const canonicalNet = candidateNetBps\(candidate\)/);
assert.match(stageOneSpread, /!clearsStageOneOutputFloorBps\(canonicalNet\)/);
assert.match(stageOneSpread, /source: 'canonical_net_bps_stage_one'/);
assert.match(stageOneSpread, /zeroCapitalDisplayedSpreadAuthority: 'canonical_all_in_net_bps_after_gas_flash_and_relay_costs'/);
assert.match(stageOneSpread, /zeroCapitalStageOneFloorStrictlyGreaterThan: true/);

// A successfully quoted route remains measurable regardless of economic quality.
assert.doesNotMatch(quoter, /if \(netProfitBps < discoveryFloorBps\) return null/);
assert.match(quoter, /bpsToBreakEven: netProfitBps >= 0 \? 0 : Math\.abs\(netProfitBps\)/);
assert.match(quoter, /executablePositive: netProfit > 0n/);
assert.match(quoter, /const positive = observed\.filter\(quote => quote\.netProfit > 0n\)/);
assert.match(quoter, /const selectionPool = positive\.length > 0 \? positive : observed/);
assert.doesNotMatch(quoter, /const selectionPool = admissible\.length > 0 \? admissible : observed/);

// Preliminary dynamic discovery must not invent a flash-loan BPS cost. The exact
// provider stage remains the sole fee/liquidity authority before eligibility.
assert.doesNotMatch(dynamic, /ZERO_CAPITAL_DYNAMIC_FLASH_LOAN_FEE_BPS/);
assert.doesNotMatch(dynamic, /flashLoanFeeBps:\s*bounded\(/);
assert.match(dynamic, /Preliminary discovery intentionally leaves flash-loan cost unpriced/);

// Dynamic gas valuation must use the same provider-neutral live-price authority as
// configured-route economics. Direct CoinGecko dependence can never suppress the
// dynamic candidate/BPS stream when that one provider is exhausted or cooling down.
assert.match(dynamic, /import \{ livePriceMesh \} from '\.\.\/bridge\/live-price-mesh\.js'/);
assert.match(dynamic, /livePriceMesh\.getLiveSymbolPrices\(\['ETH'\]\)/);
assert.doesNotMatch(dynamic, /coinGeckoPriceClient/);

// Provider evidence is independently bounded. Each applicable protocol gets its
// own timeout and route-local canonical RPC failover. Cross-protocol aggregation
// uses allSettled so one rejected protocol cannot erase fulfilled evidence from
// another; only an all-rejected applicable set propagates failure.
assert.match(providerEconomics, /function providerMeasurementTimeoutMs\(\): number/);
assert.match(providerEconomics, /ZERO_CAPITAL_FLASH_PROVIDER_MEASUREMENT_TIMEOUT_MS/);
assert.match(providerEconomics, /function withProviderMeasurementTimeout<T>/);
assert.match(providerEconomics, /function isCanonicalManagedProvider\(chain: SupportedExecutionChain, provider: providers\.Provider\): boolean/);
assert.match(providerEconomics, /function measureWithRouteLocalFailover\(/);
assert.match(providerEconomics, /withProviderMeasurementTimeout\(measure\(input\.provider\), timeoutMs, kind\)/);
assert.match(providerEconomics, /multiProviderRpcManager\.execute\([\s\S]*'contract_calls'[\s\S]*rpc => withProviderMeasurementTimeout\(measure\(rpc\), timeoutMs, kind\)/);
assert.match(providerEconomics, /flash-loan evidence failed on the current RPC and canonical route-local failover/);
assert.match(providerEconomics, /kind: 'balancer_v2'[\s\S]*promise: measureWithRouteLocalFailover\([\s\S]*'balancer_v2'[\s\S]*measureBalancerFlashLoanEconomics/);
assert.match(providerEconomics, /kind: 'aave_v3'[\s\S]*promise: measureWithRouteLocalFailover\([\s\S]*'aave_v3'[\s\S]*measureAaveV3FlashLoanEconomics/);
assert.match(providerEconomics, /kind: 'morpho_blue'[\s\S]*promise: measureWithRouteLocalFailover\([\s\S]*'morpho_blue'[\s\S]*measureMorphoBlueFlashLoanEconomics/);
assert.match(providerEconomics, /Promise\.allSettled\(attempts\.map\(attempt => attempt\.promise\)\)/);
assert.match(providerEconomics, /result\.status === 'fulfilled' && result\.value/);
assert.match(providerEconomics, /settled\.every\(result => result\.status === 'rejected'\)/);
assert.match(providerEconomics, /All applicable flash-loan provider measurements failed/);
assert.match(providerEconomics, /morpho_blue_core_flashFee_zero_by_interface/);
assert.match(providerEconomics, /synthetic_evidence:false/);

// Slow route families retain route-local P95/timeout suppression but can no longer
// collapse unrelated candidate throughput below the configured chain base lane.
assert.match(apeV4, /const floor = Math\.min\(maximum, baseRescueConcurrency\(\)\)/);
assert.match(apeV4, /Math\.max\(floor, current - 1\)/);
assert.match(apeV4, /slowRouteTimeoutCanCollapseChainBelowBase: false/);
assert.match(apeV4, /routeLatencyIsolation: 'route_id_p95_timeout_plus_chain_candidate_floor'/);

// Composite split execution is a real additive capability. The manager prepares a
// separately salted V2 receiver through the same zero-operator-capital funding path,
// publishes its runtime address, and a composite-only failure cannot disable the
// already-supported standalone receiver.
assert.match(receiverManager, /COMPOSITE_RECEIVER_SALT/);
assert.match(receiverManager, /CryptocrawlBalancerCompositeFlashLoanReceiver\.json/);
assert.match(receiverManager, /async ensureCompositeReceiver\(/);
assert.match(receiverManager, /ZERO_CAPITAL_BALANCER_COMPOSITE_RECEIVERS/);
assert.match(receiverManager, /Composite V2 receiver preparation degraded locally/);
assert.match(receiverManager, /standaloneReceiverReady: true/);
assert.match(receiverManager, /compositeOnlyFailure: true/);
assert.match(routeSplit, /runZeroCapitalAtomicStackTactic\(/);
assert.match(routeSplit, /exactCompositeEthCallRequiredBeforePromotion: true/);
assert.match(routeSplit, /exactCompositeGasEstimateRequiredBeforePromotion: true/);
assert.match(routeSplit, /aggregateCompositeEconomicsAuthoritative: true/);

// Multi-provider capital remains executable only where the nested callback topology
// is actually proven. Aave+Balancer is persisted for the canonical executor, while
// Morpho remains independently available as a zero-fee single provider rather than
// being fabricated into an unsupported nested topology.
assert.match(providerWiring, /selectMeasuredDualFlashLoanAllocation/);
assert.match(providerWiring, /provider: 'aave_balancer_dual'/);
assert.match(providerWiring, /dualFlashLoanProviderSelectionRegistry\.record/);
assert.match(providerWiring, /capabilities\.single\.set\('morpho_blue'/);
assert.match(dualReceiver, /Balancer is the outer loan; Aave is nested inside the Balancer callback/);
assert.match(dualReceiver, /executeOperation/);
assert.match(dualReceiver, /receiveFlashLoan/);

// CanonicalZeroCapitalDiscovery is the only recurring ZERO_CAPITAL_ATOMIC scan
// cadence. Receiver preparation is single-flight and watchdog-bounded, but a slow
// receiver chain cannot globally suppress fresh quote/provider measurement on
// unrelated chains. Each chain's provider stage independently proves funding,
// receiver capability and permissions before eligibility.
assert.match(discovery, /class DiscoveryWatchdogTimeoutError extends Error/);
assert.match(discovery, /function receiverFleetWatchdogMs\(\): number/);
assert.match(discovery, /function chainScanWatchdogMs\(\): number/);
assert.match(discovery, /ZERO_CAPITAL_CHAIN_SCAN_WATCHDOG_MS, 45_000, 5_000, 120_000/);
assert.match(discovery, /function withWatchdog<T>/);
assert.match(discovery, /function currentReceiverFleetTask\(target: CanonicalZeroCapitalRuntime\): Promise<void>/);
assert.match(discovery, /if \(receiverFleetTask\) return receiverFleetTask/);
assert.match(discovery, /function refreshReceiverFleetForCycle\(target: CanonicalZeroCapitalRuntime\): void/);
assert.match(discovery, /const task = currentReceiverFleetTask\(target\)/);
assert.match(discovery, /void withWatchdog\(task, receiverFleetWatchdogMs\(\), 'zero-capital receiver fleet'\)\.then/);
assert.match(discovery, /globalProviderAdmissionBlocked: false/);
assert.match(discovery, /async function scanOneChain\([\s\S]*const funding = await strictFunding\(target, chain\)/);
assert.match(discovery, /const resourceReady = funding\.mode !== 'unavailable'[\s\S]*funding\.strictZeroInitialCapitalEligible === true[\s\S]*funding\.operatorMonetaryInputRequired === false[\s\S]*receiverReady/);
assert.match(discovery, /runFairZeroCapitalProfitabilityRescue\(/);
assert.match(discovery, /const selected = await repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /getGasFundingDecision: selectedChain => strictFunding\(target, selectedChain\)/);
assert.match(discovery, /runChainScanWithWatchdog\(chain, provider\)/);
assert.match(discovery, /const chainScanTasks = new Map<SupportedChain, Promise<void>>\(\)/);
assert.match(discovery, /if \(existing\) \{[\s\S]*duplicate scan suppressed[\s\S]*return;/);
assert.match(discovery, /await withWatchdog\(tracked, chainScanWatchdogMs\(\), `zero-capital \$\{chain\} chain scan`\)/);
assert.match(discovery, /timedOutScanOwnershipReleased: error instanceof DiscoveryWatchdogTimeoutError/);
assert.match(discovery, /lateTimedOutScanGenerationInvalidated: error instanceof DiscoveryWatchdogTimeoutError/);
assert.match(discovery, /function schedule\(\): void/);
assert.match(discovery, /cycleInFlight = cycle\(\)\.finally\(\(\) => \{ cycleInFlight = null; schedule\(\); \}\)/);
assert.match(discovery, /degradedReceiverCycleMode: 'chain_local_admission_provider_repricing_continues'/);
assert.match(discovery, /globalReceiverFailureBlocksProviderAdmission: false/);
assert.match(discovery, /schedulerAuthority:\s*false/);
assert.match(discovery, /executionAuthority:\s*false/);

// The runtime core is measurement-only. Configured and dynamic candidates must
// converge before one fairness-ordered Atomic transformation pass; a hidden first
// Rescue V2 pass here consumes the short live evidence TTL and is forbidden.
assert.match(core, /Atomic rescue belongs to that canonical discovery layer/);
assert.match(core, /duplicateAtomicRescuePass: false/);
assert.match(core, /return accepted;/);
assert.doesNotMatch(core, /runZeroCapitalProfitabilityRescueV2/);

// Atomic fairness is durable Overflow scheduling metadata, not an execution or
// economics authority. The runtime schema must provision and verify the existing
// migration instead of allowing a stale schema marker to skip it.
assert.match(fairness, /public\.cryptocrawler_zero_capital_rescue_fairness/);
assert.match(fairness, /pg_advisory_xact_lock/);
assert.match(overflowSchema, /const SCHEMA_VERSION = 28/);
assert.match(overflowSchema, /cryptocrawl:overflow-runtime-schema:v28/);
assert.match(overflowSchema, /'059_cryptocrawler_zero_capital_rescue_fairness\.sql'/);
assert.match(overflowSchema, /26: \['057_cryptocrawler_ghost_wallet_runtime\.sql', '059_cryptocrawler_zero_capital_rescue_fairness\.sql'\]/);
assert.match(overflowSchema, /27: \['059_cryptocrawler_zero_capital_rescue_fairness\.sql'\]/);
assert.match(overflowSchema, /'public\.cryptocrawler_zero_capital_rescue_fairness'/);
assert.match(fairnessMigration, /CREATE TABLE IF NOT EXISTS public\.cryptocrawler_zero_capital_rescue_fairness/);
assert.match(fairnessMigration, /PRIMARY KEY \(chain, route_id\)/);
assert.match(fairnessMigration, /stores no executable quote and never changes canonical profitability or execution authority/);

// Search/compute attention may retain a bounded exploration lane, but stale
// cumulative zero-capital history cannot claim variable profitability allocation
// after the current unexpired candidate set becomes empty.
assert.match(mesh, /const zeroObserved = zero\?\.observedCandidates \?\? 0/);
assert.match(mesh, /const zeroQuoteUtilization = zeroObserved > 0/);
assert.match(mesh, /const zeroPositiveYield = zeroObserved > 0/);
assert.match(mesh, /let zeroRaw = zeroObserved <= 0[\s\S]*\? 0/);
assert.match(mesh, /if \(zeroRaw > 0\) \{/);
assert.match(mesh, /zeroCapitalCurrentCandidateAuthority: zeroObserved > 0 \? 'current_unexpired_candidates' : 'exploration_floor_only'/);
assert.match(mesh, /const zeroFloor = bounded\(process\.env\.CRYPTOCRAWL_BPS_MESH_ZERO_CAPITAL_FLOOR/);

// Execution remains strict positive all-in and belongs only to the canonical executor.
assert.match(executor, /Sole ZERO_CAPITAL_ATOMIC execution route/);
assert.match(executor, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(executor, /opportunity\.netProfitBps > 0/);
assert.match(executor, /Canonical all-in net economics are not strictly positive/);

console.log('[zero-capital-quote-liveness] bounded RPC/provider/receiver/chain work, canonical Stage-1 all-in net BPS, strict > -10 visibility, exact-block RPC evidence reuse, mesh-global singleflight, event-driven invalidation, bounded quote batching, slow-route concurrency isolation, additive composite receiver bootstrap, exact composite split proof, executable Aave+Balancer provider stacking, truthful Morpho single-provider capability, live-price mesh gas valuation, timeout ownership recovery, route-local RPC failover, cross-provider rejection isolation, chain-local funding proof, single-pass fairness-ordered Atomic rescue, durable fairness schema authority, dynamic provider economics, current-candidate BPS allocation, numeric negative-route measurement, recurring liveness recovery, and positive-only canonical execution verified');
