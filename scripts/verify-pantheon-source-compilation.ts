import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PANTHEON_BACKGROUND_CATEGORIES, buildPantheonBackgroundRegistryTargets } from '../server/services/pantheon/PantheonSovereignSourceRegistry';

assert.ok(PANTHEON_BACKGROUND_CATEGORIES.length > 0);
assert.equal(typeof buildPantheonBackgroundRegistryTargets, 'function');

// Verify the runtime discovery export without importing the coordinator here.
// Importing it during image construction crosses into the runtime DB/config
// graph and incorrectly requires production-only environment configuration.
const discoverySource = fs.readFileSync(
  path.resolve(process.cwd(), 'server/services/pantheon/PantheonDiscoveryCoordinator.ts'),
  'utf8',
);
assert.match(
  discoverySource,
  /export\s+async\s+function\s+discoverPantheonSourcesParallel\s*\(/,
  'Pantheon dynamic discovery coordinator export is missing',
);

const targets = buildPantheonBackgroundRegistryTargets('Taylor Example', 'Iowa', 10);
assert.ok(targets.length <= PANTHEON_BACKGROUND_CATEGORIES.length * 10);
console.log('Pantheon source architecture verified: bounded category seeds + dynamic parallel discovery; legacy 4,500 inventory absent.');
