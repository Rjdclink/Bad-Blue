const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const policy = read('server/services/cryptocrawl/discovery/stage-one-candidate-policy.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const admission = read('server/services/cryptocrawl/integration/ape-measured-opportunity-admission.ts');

// One canonical Stage-One threshold, and it is strict: -10.000 BPS itself does not pass.
assert.match(policy, /STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS = -10/);
assert.match(policy, /netProfitBps > STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS/);
assert.doesNotMatch(policy, /netProfitBps >= STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS/);

// Stage One preserves broad raw discovery evidence, but publication and both handoff
// boundaries use the same strict output policy.
assert.match(discovery, /zeroCapitalRouteEvidenceRegistry\.record\(opportunity\)/);
assert.match(discovery, /if \(!clearsStageOneCandidateOutputFloor\(opportunity\)\)/);
assert.match(discovery, /&& clearsStageOneCandidateOutputFloor\(opportunity\)/);
assert.match(discovery, /rescueReady = rescueReady\.filter\(clearsStageOneCandidateOutputFloor\)/);
assert.match(discovery, /stageOneCandidateComparator: 'netProfitBps > -10'/);
assert.match(discovery, /stageOneAtFloorPromoted: false/);

// Promoted candidates carry the exact Stage-One discovery evidence APE consumes.
assert.match(discovery, /rawQuotes: opportunity\.route\.map/);
assert.match(discovery, /depth: \{ status: 'measured'/);
assert.match(discovery, /economics: canonicalEconomics\(opportunity, quote\)/);
assert.match(discovery, /quoteAgeMs: opportunity\.quoteLatencyMs/);
assert.match(discovery, /'direct_contract_quotes'/);
assert.match(discovery, /'measured_all_in_economics'/);
assert.match(discovery, /'exact_route_evidence:zero_capital_route_evidence_registry'/);

// Defense in depth: APE rejects <= -10 even if a future caller bypasses Stage One.
assert.match(admission, /clearsStageOneOutputFloorBps/);
assert.match(admission, /stage_one_output_floor_violation/);
assert.match(admission, /if \(!clearsStageOneOutputFloorBps\(opportunity\.netProfitBps\)\)/);
assert.match(admission, /if \(canonicalNetBps !== null && !clearsStageOneOutputFloorBps\(canonicalNetBps\)\)/);

console.log('Stage One strict > -10 BPS output contract verified.');
