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

// Pressure may still raise a lower density-derived profile when backlog/unexplored
// demand is stronger than the measured-density signal.
assert.equal(
  reconcileDiscoveryProfile(
    'medium',
    profileForDiscoveryPressure({ searchPressure: 0.80, resourceSaturation: 0, candidateBacklog: 5 }, 'medium'),
    0,
  ),
  'burst',
  'strong pressure must be allowed to raise discovery capacity',
);

// Backlog alone prevents a low pressure score from collapsing active discovery.
assert.equal(
  reconcileDiscoveryProfile(
    'low',
    profileForDiscoveryPressure({ searchPressure: 0.05, resourceSaturation: 0, candidateBacklog: 1 }, 'low'),
    0,
  ),
  'medium',
  'active backlog must retain at least medium discovery pressure',
);

// Explicit near-saturation protection is the only automatic authority allowed to
// downgrade BURST, and it may reduce only to HIGH.
const saturated = { searchPressure: 0.60, resourceSaturation: 0.96, candidateBacklog: 50 };
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
    profileForDiscoveryPressure({ searchPressure: 0.10, resourceSaturation: 0, candidateBacklog: 0 }, 'high'),
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
assert.doesNotMatch(
  wiringSource,
  /const desired = profileForPressure\(pressure, fallback\)/,
  'legacy direct pressure overwrite must not return',
);

console.log('Dynamic-scale profile authority verification passed');
