'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const fairRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const ape = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const resident = read('server/services/cryptocrawl/integration/atomic-profitability-resident-routing.ts');
const workers = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-workers.ts');
const providerReprice = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');

// Stage 1 stays locked exactly where production proved it.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /opportunity\.netProfitBps >= atomicSurplusEntryFloorBps\(\)/);
assert.match(discovery, /runFairZeroCapitalProfitabilityRescue\(\{/);
assert.match(discovery, /opportunities: exact/);
assert.match(discovery, /const selected = await repriceZeroCapitalProviderEconomics\(/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);

// Fused Stage-1 -> APE continuation: same objects, no handoff machinery or copies.
assert.match(fairRescue, /primeApeResidentRouting\(input\.opportunities\)/);
assert.match(fairRescue, /runZeroCapitalAtomicBpsEngine\(\{/);
assert.match(fairRescue, /opportunities: input\.opportunities/);
assert.match(fairRescue, /stageOneSameReferenceContinuation: true/);
assert.match(fairRescue, /stageOneStructuralCopies: 0/);
assert.match(fairRescue, /stageTwoHandoffSupervisorOnHotPath: false/);
assert.match(fairRescue, /const postDecision = setImmediate\(/);
assert.doesNotMatch(fairRescue, /copyOpportunity/);
assert.doesNotMatch(fairRescue, /handoffStageOneToAtomicBps/);
assert.doesNotMatch(fairRescue, /stageOneSnapshot/);
assert.doesNotMatch(fairRescue, /queueMicrotask/);

// APE itself is local/in-memory only. No exploratory quote/provider/price/database work.
assert.match(ape, /export function runZeroCapitalAtomicBpsEngine/);
assert.match(ape, /opportunity\.expectedProfit > 0n/);
assert.match(ape, /maximize_exact_executable_net_bps_from_already_arrived_evidence/);
assert.match(ape, /routeQuotesCreatedByApe: 0/);
assert.match(ape, /rpcCallsCreatedByApe: 0/);
assert.match(ape, /apiCallsCreatedByApe: 0/);
assert.match(ape, /supabaseReadsCreatedByApe: 0/);
assert.match(ape, /supabaseWritesCreatedByApe: 0/);
assert.match(ape, /duplicateFlashChecksCreatedByApe: 0/);
assert.match(ape, /waitsForSlowerUnfinishedRoutes: false/);
assert.match(ape, /residentRouting: '2_active_plus_1_hedge_plus_2_dormant_reserve'/);
assert.match(ape, /const telemetry = setImmediate\(/);
assert.match(ape, /return ordered;/);
assert.doesNotMatch(ape, /quoteConfiguredZeroCapitalRoute/);
assert.doesNotMatch(ape, /prewarmAtomicBpsEvidence/);
assert.doesNotMatch(ape, /refreshAtomicBpsProviderEvidence/);
assert.doesNotMatch(ape, /measureFlashLoanProviders/);
assert.doesNotMatch(ape, /livePriceMesh/);
assert.doesNotMatch(ape, /from\(['"]@supabase|from ['"].*supabase|\.from\(['"]/i);
assert.doesNotMatch(ape, /Promise\.all|Promise\.race|await\s+/);
assert.doesNotMatch(ape, /queueMicrotask/);
assert.doesNotMatch(ape, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);

// Resident contextual routing is exactly 2 active + 1 hedge + 2 reserve, with
// additional cohorts rather than an eligibility cap.
assert.match(resident, /export type ApeResidentRole = 'active' \| 'hedge' \| 'reserve'/);
assert.match(resident, /if \(slot <= 1\) return 'active'/);
assert.match(resident, /if \(slot === 2\) return 'hedge'/);
assert.match(resident, /return 'reserve'/);
assert.match(resident, /const slot = \(index % 5\)/);
assert.match(resident, /cohort: Math\.floor\(index \/ 5\)/);
assert.match(resident, /activePerCohort: 2/);
assert.match(resident, /maximumHedgePerCohort: 1/);
assert.match(resident, /dormantReservesPerCohort: 2/);
assert.match(resident, /stageOneObjectsCopied: false/);
assert.match(resident, /externalIo: false/);
assert.doesNotMatch(resident, /fetch\(|axios|supabase|provider\.|Contract\(|Promise\.all|Promise\.race|await\s+/);

// Compatibility workers can no longer reintroduce live APE I/O.
assert.match(workers, /compatibility_snapshot_only_no_live_io/);
assert.match(workers, /livePriceCalls: 0/);
assert.match(workers, /liveProviderMeasurements: 0/);
assert.match(workers, /rpcCalls: 0/);
assert.match(workers, /apiCalls: 0/);
assert.doesNotMatch(workers, /livePriceMesh/);
assert.doesNotMatch(workers, /atomic-profitability-provider-race/);
assert.doesNotMatch(workers, /measureFlashLoanProviders/);

// Canonical provider proof and execution authorities remain exactly downstream.
assert.match(providerReprice, /measureFlashLoanProviders\(/);
assert.match(providerReprice, /selectMeasuredFlashLoanProvider\(/);
assert.match(providerReprice, /executionAuthority: false/);
assert.match(scheduler, /decision\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scheduler, /opportunity\.expectedProfit > 0n/);
assert.match(scheduler, /executeCanonicalZeroCapitalOpportunity\(/);
assert.match(executor, /opportunity\.expectedProfit <= 0n/);
assert.doesNotMatch(executor, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);

assert.equal(
  fs.existsSync('server/services/cryptocrawl/integration/atomic-profitability-provider-race.ts'),
  false,
  'obsolete APE live-provider race must remain removed',
);

console.log('APE zero-copy BPS propagation verification passed');
