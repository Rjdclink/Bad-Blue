'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const bps = fs.readFileSync('server/services/cryptocrawl/integration/bps-decomposition-observability.ts', 'utf8');
const recovery = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-recovery-observability.ts', 'utf8');
const scale = fs.readFileSync('server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts', 'utf8');

// Current BPS surfaces must be based on unexpired canonical measured economics.
for (const [name, source] of [['bps decomposition', bps], ['zero-capital recovery', recovery]]) {
  assert.match(source, /getRecent\(4096\)/, `${name} must inspect the full default registry capacity before topology filtering`);
  assert.match(source, /candidate\.status !== 'expired'/, `${name} must exclude expired status`);
  assert.match(source, /candidate\.expiresAt > now/, `${name} must exclude elapsed opportunity TTLs`);
  assert.match(source, /candidate\.canonicalBps\.netBps/, `${name} must consume canonical BPS economics`);
}
assert.match(bps, /currentCandidateAuthority: 'unexpired_canonical_bps_only'/);
assert.match(bps, /staleCandidateEconomicAuthority: false/);
assert.match(recovery, /candidateAuthority: 'unexpired_canonical_bps_only'/);
assert.match(recovery, /staleCandidateEconomicAuthority: false/);

// Dynamic-scale search pressure may use near-break-even density, but only from
// still-live candidates. Expired BPS must never keep search pressure elevated.
assert.match(scale, /function freshZeroCapitalBps\(\)/);
assert.match(scale, /candidate\.topology === 'ZERO_CAPITAL_ATOMIC'/);
assert.match(scale, /candidate\.status !== 'expired'/);
assert.match(scale, /candidate\.expiresAt > now/);
assert.match(scale, /candidate\.canonicalBps\.netBps/);
assert.match(scale, /zeroCapitalNearBreakEvenPerMinute: zeroCapital\.nearBreakEven/);
assert.match(scale, /zeroCapitalBestNetProfitBps: zeroCapital\.bestNetProfitBps/);
assert.match(scale, /zeroCapitalAverageBpsToBreakEven: zeroCapital\.averageBpsToBreakEven/);
assert.doesNotMatch(scale, /zeroCapitalNearBreakEvenPerMinute: candidate\.zeroCapitalBps\.nearBreakEven/);
assert.match(scale, /nearBreakEvenAuthority: 'fresh_unexpired_search_formation_pressure_only'/);
assert.match(scale, /staleNearBreakEvenEconomicAuthority: false/);

// These changes are telemetry/search-pressure only. They may not create an
// execution, profitability, or capital-movement authority.
assert.match(bps, /executionAuthority: false/);
assert.match(recovery, /executionAuthority: false/);
assert.match(bps, /syntheticProfitAllowed: false/);
assert.match(recovery, /syntheticProfitAllowed: false/);

console.log(JSON.stringify({
  currentBpsFreshness: 'verified',
  expiredOpportunityEconomicAuthority: false,
  canonicalBpsAuthority: true,
  dynamicScaleNearBreakEvenUsesFreshCandidatesOnly: true,
  executionAuthorityChanged: false,
}, null, 2));
