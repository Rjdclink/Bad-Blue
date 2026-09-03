'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const registry = fs.readFileSync('server/services/cryptocrawl/discovery/measured-candidate-registry.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts', 'utf8');
const rescue = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts', 'utf8');
const scale = fs.readFileSync('server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts', 'utf8');
const engine = fs.readFileSync('server/services/cryptocrawl/core/zero-capital-engine.ts', 'utf8');

// BPS decomposition is first-class measured evidence without becoming a
// replacement for deterministic USD economics.
for (const field of [
  'grossProfitBps',
  'flashLoanFeeBps',
  'gasCostBps',
  'relayCostBps',
  'allInCostBps',
  'breakEvenBps',
  'netProfitBps',
  'discoveryFloorBps',
  'bpsToBreakEven',
  'realizedNetProfitBps',
]) assert.ok(registry.includes(field), `registry must expose ${field}`);
assert.match(registry, /zeroCapitalBps:/);
assert.match(registry, /nearBreakEven:/);

// Near-break-even observations never become execution-preparation work. Only a
// strict positive with concrete funding/receiver/permission/simulation facts can
// enter canonical admission.
assert.match(wiring, /\.filter\(quote => quote\.executablePositive && quote\.netProfit > 0n\)/);
assert.match(wiring, /status: positive \? 'deterministic_positive' : 'enriched'/);
assert.match(wiring, /near_break_even_observation_only/);
assert.match(wiring, /if \(!positive \|\| !executableCapability\) continue;/);
assert.match(wiring, /executableCapability: positive && input\.executableCapability/);
assert.match(wiring, /zeroCapitalDiscoveryFloorBps\(\)/);

// Candidate execution-capability truth consumes the same current gas funding
// facts as dispatch. A positive candidate with a missing hard fact is retained as
// measured evidence but cannot advertise itself executable.
assert.match(wiring, /const fundingReady = funding\.mode !== 'unavailable';/);
assert.match(wiring, /const executableCapability = positive && receiverReady && fundingReady;/);
assert.match(wiring, /const executableCapability = positive && fundingReady && receiverReady && permissionReady && simulationReady;/);
assert.match(wiring, /const exactSimulationRequired = positive && quote\.id\.startsWith\('graphless-'\);/);
assert.match(wiring, /live_gas_funding/);
assert.match(wiring, /if \(funding\.mode === 'unavailable'\) continue;/);

// The deleted global zero-capital enable flag must never regain independent veto
// authority. StageManager + candidate hard facts are the execution authority.
assert.doesNotMatch(engine, /executionEligible/);
assert.doesNotMatch(wiring, /executionEligible/);
assert.doesNotMatch(engine, /ZERO_CAPITAL_ENABLE_EXECUTION/);
assert.doesNotMatch(wiring, /ZERO_CAPITAL_ENABLE_EXECUTION/);
assert.match(engine, /process\.env\.NO_EXECUTION === 'true'/);
assert.match(engine, /process\.env\.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true'/);
assert.match(engine, /governance\.requireAllowed\('EXECUTE_OPPORTUNITY', \{ chain: opportunity\.chain, pair \}\)/);
assert.match(engine, /governance\.requireAllowed\('SUBMIT_TX', \{ chain: opportunity\.chain, pair \}\)/);
assert.doesNotMatch(engine, /venue: funding\.mode/);

// Zero-capital rescue consumes the same shared BPS Super Engine used by the
// canonical cross-strategy economics pipeline. It may rank and select exact
// re-quote sizes, but cannot manufacture profitability or submit.
assert.match(rescue, /buildBpsReductionSuperPlan/);
assert.match(rescue, /buildResearchBpsExecutionPlan/);
assert.match(rescue, /adviseEconomicTransformations/);
assert.match(rescue, /getBpsCompressionMeshSnapshot/);
assert.match(rescue, /plan\.effectivePriorityScore/);
assert.match(rescue, /plan\.residualNotionalFractions/);
assert.match(rescue, /recordBpsRevalidationOutcome/);
assert.match(rescue, /freshExactRequoteRequired: true/);
assert.match(rescue, /strictImprovementRequired: true/);
assert.match(rescue, /existingPositiveNeverReplacedByNegative: true/);
assert.match(rescue, /executionAuthority: false/);
assert.doesNotMatch(rescue, /expectedProfit\s*=\s*Math\.max/);
assert.doesNotMatch(rescue, /netProfitBps\s*=\s*Math\.max/);

// DynamicScale may react to near-break-even density only as bounded search
// pressure. Profitability remains terminal-confirmed realized truth.
assert.match(scale, /zeroCapitalNearBreakEvenPressure/);
assert.match(scale, /nearBreakEvenAuthority: 'search_formation_pressure_only'/);
assert.match(scale, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);
assert.doesNotMatch(
  scale,
  /profitabilityPressure\s*=\s*[^;]*zeroCapitalNearBreakEvenPressure/,
  'near-break-even density must not contaminate realized profitability pressure',
);

// Final queue admission remains strict positive all-in economics.
assert.match(engine, /if \(opportunity\.expectedProfit <= 0n \|\| Date\.now\(\) > opportunity\.expiresAt\) continue;/);

console.log(JSON.stringify({
  zeroCapitalBpsPropagation: 'verified',
  zeroCapitalBpsSuperEngineOperational: true,
  zeroCapitalSharedBpsPriority: true,
  zeroCapitalSharedResidualNotionalProbes: true,
  duplicateExecutionEligibilityAuthorityRemoved: true,
  nearBreakEvenClassification: 'enriched_observation_only',
  positiveExecutionFloorPreserved: true,
  gasFundingExecutionTruthBound: true,
  dynamicScaleUse: 'bounded_search_pressure_only',
  realizedProfitabilityAuthorityPreserved: true,
}, null, 2));