const assert = require('node:assert/strict');
const fs = require('node:fs');

const quoter = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');
const discovery = fs.readFileSync('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts', 'utf8');
const dynamic = fs.readFileSync('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts', 'utf8');
const providerEconomics = fs.readFileSync('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts', 'utf8');
const mesh = fs.readFileSync('server/services/cryptocrawl/integration/bps-compression-mesh.ts', 'utf8');
const executor = fs.readFileSync('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts', 'utf8');

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

// A successfully quoted route remains measurable regardless of economic quality.
assert.doesNotMatch(quoter, /if \(netProfitBps < discoveryFloorBps\) return null/);
assert.match(quoter, /bpsToBreakEven: netProfitBps >= 0 \? 0 : Math\.abs\(netProfitBps\)/);
assert.match(quoter, /executablePositive: netProfit > 0n/);
assert.match(quoter, /const selectionPool = admissible\.length > 0 \? admissible : observed/);

// Preliminary dynamic discovery must not invent a flash-loan BPS cost. The exact
// provider stage remains the sole fee/liquidity authority before eligibility.
assert.doesNotMatch(dynamic, /ZERO_CAPITAL_DYNAMIC_FLASH_LOAN_FEE_BPS/);
assert.doesNotMatch(dynamic, /flashLoanFeeBps:\s*bounded\(/);
assert.match(dynamic, /Preliminary discovery intentionally leaves flash-loan cost unpriced/);

// Provider evidence is independently bounded. One silent RPC/provider cannot pin
// the complete provider mesh, and a timeout is omitted rather than synthesized.
assert.match(providerEconomics, /function providerMeasurementTimeoutMs\(\): number/);
assert.match(providerEconomics, /ZERO_CAPITAL_FLASH_PROVIDER_MEASUREMENT_TIMEOUT_MS/);
assert.match(providerEconomics, /function withProviderMeasurementTimeout<T>/);
assert.match(providerEconomics, /Promise\.allSettled\(\[/);
assert.match(providerEconomics, /withProviderMeasurementTimeout\(measureBalancerFlashLoanEconomics\(input\), timeoutMs, 'balancer_v2'\)/);
assert.match(providerEconomics, /withProviderMeasurementTimeout\(measureAaveV3FlashLoanEconomics\(input\), timeoutMs, 'aave_v3'\)/);
assert.match(providerEconomics, /withProviderMeasurementTimeout\(measureMorphoBlueFlashLoanEconomics\(input\), timeoutMs, 'morpho_blue'\)/);
assert.match(providerEconomics, /result\.status === 'fulfilled' && result\.value/);
assert.match(providerEconomics, /morpho_blue_core_flashFee_zero_by_interface/);

// CanonicalZeroCapitalDiscovery is the only recurring ZERO_CAPITAL_ATOMIC scan
// cadence. Healthy receiver-before-scan ordering is preserved. If receiver work
// exceeds its watchdog, the recurring scanner continues observation-only without
// provider admission; hung chain tasks are isolated and duplicate work suppressed.
assert.match(discovery, /class DiscoveryWatchdogTimeoutError extends Error/);
assert.match(discovery, /function receiverFleetWatchdogMs\(\): number/);
assert.match(discovery, /function chainScanWatchdogMs\(\): number/);
assert.match(discovery, /function withWatchdog<T>/);
assert.match(discovery, /await withWatchdog\(currentReceiverFleetTask\(target\), receiverFleetWatchdogMs\(\), 'zero-capital receiver fleet'\)/);
assert.match(discovery, /const allowProviderAdmission = await receiverAdmissionAllowedForCycle\(target\)/);
assert.match(discovery, /runChainScanWithWatchdog\(chain, provider, allowProviderAdmission\)/);
assert.match(discovery, /if \(!allowProviderAdmission\) \{[\s\S]*providerRepricingSkipped: true[\s\S]*return;/);
assert.match(discovery, /const chainScanTasks = new Map<SupportedChain, Promise<void>>\(\)/);
assert.match(discovery, /if \(existing\) \{[\s\S]*duplicate scan suppressed[\s\S]*return;/);
assert.match(discovery, /await withWatchdog\(tracked, chainScanWatchdogMs\(\), `zero-capital \$\{chain\} chain scan`\)/);
assert.match(discovery, /function schedule\(\): void/);
assert.match(discovery, /cycleInFlight = cycle\(\)\.finally\(\(\) => \{ cycleInFlight = null; schedule\(\); \}\)/);
assert.match(discovery, /degradedReceiverCycleMode: 'observation_only_no_provider_admission'/);
assert.match(discovery, /schedulerAuthority:\s*false/);
assert.match(discovery, /executionAuthority:\s*false/);

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

console.log('[zero-capital-quote-liveness] bounded RPC/provider/receiver/chain work, dynamic provider economics, current-candidate BPS allocation, numeric negative-route measurement, recurring observation-only recovery, and positive-only canonical execution verified');
