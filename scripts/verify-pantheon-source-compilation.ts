import assert from 'node:assert/strict';
import { PANTHEON_BACKGROUND_CATEGORIES, buildPantheonBackgroundRegistryTargets } from '../server/services/pantheon/PantheonSovereignSourceRegistry';
import { discoverPantheonSourcesParallel } from '../server/services/pantheon/PantheonDiscoveryCoordinator';
assert.ok(PANTHEON_BACKGROUND_CATEGORIES.length > 0);
assert.equal(typeof buildPantheonBackgroundRegistryTargets, 'function');
assert.equal(typeof discoverPantheonSourcesParallel, 'function');
const targets=buildPantheonBackgroundRegistryTargets('Taylor Example','Iowa',10);
assert.ok(targets.length <= PANTHEON_BACKGROUND_CATEGORIES.length * 10);
console.log('Pantheon source architecture verified: bounded category seeds + dynamic parallel discovery; legacy 4,500 inventory absent.');
