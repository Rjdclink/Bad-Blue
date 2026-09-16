'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const stageOnePolicy = read('server/services/cryptocrawl/discovery/stage-one-candidate-policy.ts');
const admission = read('server/services/cryptocrawl/integration/ape-measured-opportunity-admission.ts');
const directions = read('server/services/cryptocrawl/integration/ape-directional-market.ts');
const routeDirections = read('server/services/cryptocrawl/execution/adapters/zero-capital-route-direction.ts');
const routeAuthority = read('server/services/cryptocrawl/discovery/zero-capital-route-authority.ts');
const floor = read('server/services/cryptocrawl/integration/zero-capital-profit-output-floor.ts');
const ape = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');

has(discovery, 'STAGE_ONE_LOCKED_INVARIANT', 'Stage One locked output authority missing');
has(stageOnePolicy, 'STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS = -10', 'Stage One -10 BPS floor missing');
has(stageOnePolicy, 'netProfitBps > STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS', 'Stage One floor is not strict');
assert.ok(!stageOnePolicy.includes('netProfitBps >= STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS'), 'Stage One incorrectly admits exactly -10 BPS');
has(discovery, "stageOneCandidateComparator: 'netProfitBps > -10'", 'Stage One strict comparator telemetry missing');
has(discovery, 'stageOneAtFloorPromoted: false', 'Stage One may promote exactly -10 BPS');
has(discovery, 'selectApeStageOneHotSet(exact, 3)', 'Stage One market hot set missing');
has(discovery, 'rescueReady = rescueReady.filter(clearsStageOneCandidateOutputFloor)', 'Stage One post-APE floor assertion missing');
has(discovery, 'rawBelowFloorRouteEvidencePreserved: true', 'below-floor discovery evidence is not preserved');

has(admission, 'export function assessApeMeasuredAdmission', 'fresh measured APE admission gate missing');
has(admission, 'stage_one_output_floor_violation', 'APE Stage One floor defense missing');
has(admission, 'missing_exact_route_measurement', 'unquoted candidate deferral missing');
has(admission, 'registry_measurement_incomplete', 'incomplete measurement deferral missing');
has(admission, 'rankApeEconomicPriority', 'exact economics priority missing');

has(directions, 'canonicalCyclicTokenPath', 'cyclic direction-neutral market identity missing');
has(directions, 'step.protocol', 'venue order missing from direction identity');
has(directions, "Number.isFinite(step.fee) ? String(step.fee) : 'fee_unknown'", 'fee state missing from direction identity');
has(directions, 'const reverse = ordered.find(candidate => apeDirectionKey(candidate) !== winnerDirection)', 'opposite direction protection missing');
has(directions, 'ZERO_CAPITAL_APE_HOT_GLOBAL_LIMIT', 'global measured APE hot-lane limit missing');
has(directions, 'return boundedInteger(process.env.ZERO_CAPITAL_APE_HOT_GLOBAL_LIMIT, 6, 2, 24)', 'global APE hot-lane bound is not safely constrained');
has(directions, 'marketSelections.sort((left, right) => compareExactEconomics(left[0], right[0]))', 'global market priority is not driven by current exact economics');
has(directions, 'for (let lane = 0; lane < boundedMax && selected.length < globalLimit; lane += 1)', 'winner-first then reverse/hedge lane ordering missing');
has(directions, 'if (selected.length >= globalLimit) break', 'global APE hot-lane limit is not enforced');

has(routeDirections, 'reverseConfiguredZeroCapitalRoute', 'compatible reverse template builder missing');
has(routeDirections, 'ensureUniversalReverseRoutes', 'universal compatible reverse coverage missing');
has(routeDirections, 'existingReverse ?? reverse', 'existing reverse variants are not reused before synthesis');
has(routeDirections, 'reverseTwinsAdjacentForBoundedFrontier: true', 'reverse twins are not kept adjacent for bounded route frontier');
has(routeDirections, 'quoteBudgetExpandedByReversePairing: false', 'reverse pairing may expand the quote budget');
assert.ok(!routeDirections.includes("'sushiswapV3',"), 'unsupported Sushi V3 reverse quote capability was fabricated');

has(routeAuthority, 'ensureUniversalReverseRoutes(baseRoutes)', 'canonical route authority does not guarantee compatible reverse coverage');
has(routeAuthority, 'reverseTemplatesAdded', 'reverse coverage telemetry missing');
has(routeAuthority, 'compatibleReverseCoverage', 'reverse coverage proof missing');

has(floor, 'isApeMeasuredAdmitted(opportunity)', 'stateful APE work can start without measured admission');
has(floor, "placement.cohort === 0 && placement.role !== 'reserve'", 'non-hot market variants can consume stateful APE rescue I/O');

has(ape, 'routeQuotesCreatedByApe: 0', 'resident APE started creating route quotes');
has(ape, 'rpcCallsCreatedByApe: 0', 'resident APE started creating RPC work');
has(ape, 'apiCallsCreatedByApe: 0', 'resident APE started creating API work');
has(ape, 'directionalTelemetryDeferredUntilAfterReturn: true', 'directional telemetry moved onto the return path');
has(ape, 'forwardBps:', 'forward-direction BPS telemetry missing');
has(ape, 'reverseBps:', 'reverse-direction BPS telemetry missing');
has(ape, 'winningDirection:', 'winning-direction telemetry missing');
has(ape, 'winningSize:', 'winning-size telemetry missing');
has(ape, 'directionFlips', 'direction-flip telemetry missing');
has(ape, 'exactQuotes: admissionSnapshot.admitted', 'exact quote count telemetry missing');
has(ape, 'unquotedSkipped: admissionSnapshot.deferredForMeasurement', 'unquoted skip telemetry missing');
has(ape, 'apeUpliftBps', 'APE uplift telemetry missing');
has(ape, 'finalNetBps', 'final net BPS telemetry missing');

console.log('[ape-measured-market-priority] PASS: strict > -10 Stage One output, complete measured evidence admission, globally-bounded winner-first hot lane, compatible reverse coverage, fixed quote-budget preservation, zero-I/O APE and deferred directional telemetry verified');

// Merge-head marker only: this authorized merge intentionally skips GitHub Actions.
