import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  profileForDiscoveryPressure,
  reconcileDiscoveryProfile,
} from '../../server/services/cryptocrawl/scaling/dynamic-scale-profile-policy.js';

// Production-like state from the verified runtime: measured search density was
// already high enough for the primary scaler to demand BURST, while normalized
// pressure was only in the HIGH band. The wrapper must not erase BURST.
const productionLikePressure = {
  searchPressure: 0.525,
  resourceSaturation: 0,
  candidateBacklog: 25,
};
const pressureProfile = profileForDiscoveryPressure(productionLikePressure, 'burst');
assert.equal(pressureProfile, 'high');
assert.equal(
  reconcileDiscoveryProfile('burst', pressureProfile, productionLikePressure.resourceSaturation),
  'burst',
  'normalized pressure must not downgrade measured BURST discovery demand',
);

// Search demand may still raise a lower density-derived profile.
assert.equal(
  reconcileDiscoveryProfile(
    'medium',
    profileForDiscoveryPressure({ searchPressure: 0.80, resourceSaturation: 0, candidateBacklog: 5, queueBacklogPressure: 0.10 }, 'medium'),
    0,
  ),
  'burst',
  'strong search pressure must be allowed to raise discovery capacity',
);

// Queue pressure is independent: backlog can raise bounded processing capacity
// without being represented as market-search pressure.
assert.equal(
  reconcileDiscoveryProfile(
    'low',
    profileForDiscoveryPressure({ searchPressure: 0.05, resourceSaturation: 0, candidateBacklog: 0, queueBacklogPressure: 0.85 }, 'low'),
    0,
  ),
  'high',
  'high normalized queue pressure must be able to raise processing capacity independently',
);
assert.equal(
  profileForDiscoveryPressure({ searchPressure: 0.05, resourceSaturation: 0, candidateBacklog: 999, queueBacklogPressure: 0 }, 'low'),
  'low',
  'raw candidate backlog must not override an explicitly supplied normalized queue authority',
);

// Compatibility: callers that have not migrated to normalized queue pressure
// retain the prior non-collapse behavior for an active backlog.
assert.equal(
  reconcileDiscoveryProfile(
    'low',
    profileForDiscoveryPressure({ searchPressure: 0.05, resourceSaturation: 0, candidateBacklog: 1 }, 'low'),
    0,
  ),
  'medium',
  'legacy active backlog must retain at least medium processing pressure',
);

// Explicit near-saturation protection is the only automatic authority allowed to
// downgrade BURST, and it may reduce only to HIGH.
const saturated = { searchPressure: 0.60, resourceSaturation: 0.96, candidateBacklog: 50, queueBacklogPressure: 1 };
const saturatedProfile = profileForDiscoveryPressure(saturated, 'burst');
assert.equal(saturatedProfile, 'high');
assert.equal(
  reconcileDiscoveryProfile('burst', saturatedProfile, saturated.resourceSaturation),
  'high',
  'near-saturation protection must be able to reduce burst to high',
);

// A weaker pressure score may not downgrade an already-authorized profile merely
// because the two authorities use different normalization scales.
assert.equal(
  reconcileDiscoveryProfile(
    'high',
    profileForDiscoveryPressure({ searchPressure: 0.10, resourceSaturation: 0, candidateBacklog: 0, queueBacklogPressure: 0 }, 'high'),
    0,
  ),
  'high',
);

const wiringSource = readFileSync(
  new URL('../../server/services/cryptocrawl/scaling/dynamic-scale-pressure-wiring.ts', import.meta.url),
  'utf8',
);
assert.match(wiringSource, /reconcileDiscoveryProfile/);
assert.match(wiringSource, /measuredDensityProfile/);
assert.match(wiringSource, /saturationDowngrade/);
assert.match(wiringSource, /positiveOpportunityPressure/);
assert.match(wiringSource, /queueBacklogPressure/);
assert.match(wiringSource, /expectedProfitPressure/);
assert.match(wiringSource, /profitabilityAuthority: 'terminal_confirmed_realized_only'/);
assert.match(
  wiringSource,
  /const profitabilityPressure = clamp01\(\(realized \?\? 0\) \/ realizedProfitTarget\)/,
  'profitability pressure must derive from terminal-confirmed realized profit only',
);
assert.doesNotMatch(
  wiringSource,
  /clamp01\(candidateBacklog \/ backlogTarget\) \* 0\.25/,
  'candidate backlog must not be collapsed into search pressure',
);
assert.doesNotMatch(
  wiringSource,
  /canonicalMinute\.verifiedPositiveOpportunities \/ positiveTarget\) \* 0\.45[\s\S]*expected[\s\S]*realized/,
  'positive density, expected profit, and realized profit must not collapse into one scaling metric',
);
assert.doesNotMatch(
  wiringSource,
  /const desired = profileForPressure\(pressure, fallback\)/,
  'legacy direct pressure overwrite must not return',
);

const policySource = readFileSync(
  new URL('../../server/services/cryptocrawl/scaling/dynamic-scale-profile-policy.ts', import.meta.url),
  'utf8',
);
assert.match(policySource, /queueBacklogPressure\?: number/);
assert.match(policySource, /const queuePressure = snapshot\.queueBacklogPressure === undefined/);
assert.doesNotMatch(
  policySource,
  /searchPressure[\s\S]{0,200}candidateBacklog > 0\) return 'medium'/,
  'queue backlog must remain a separate policy axis rather than an implicit search-pressure branch',
);

console.log('Dynamic-scale profile authority verification passed');