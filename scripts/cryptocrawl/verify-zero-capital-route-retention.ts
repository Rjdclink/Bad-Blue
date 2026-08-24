import assert from 'node:assert/strict';
import {
  composeConfiguredZeroCapitalRoutes,
  type SupportedChain,
} from '../../server/services/cryptocrawl/core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute } from '../../server/services/cryptocrawl/execution/adapters/onchain-route-quoter.js';

function route(id: string, chain: SupportedChain): ConfiguredZeroCapitalRoute {
  return { id, chain } as ConfiguredZeroCapitalRoute;
}

const configured = [
  route('ethereum-route', 'ethereum'),
  route('europa-configured-route', 'europa'),
];

const withoutDynamic = composeConfiguredZeroCapitalRoutes(configured);
assert.deepEqual(withoutDynamic.map(candidate => candidate.id), [
  'ethereum-route',
  'europa-configured-route',
]);

const dynamic = route('europa-dynamic-route', 'europa');
const withDynamic = composeConfiguredZeroCapitalRoutes(configured, dynamic);
assert.deepEqual(withDynamic.map(candidate => candidate.id), [
  'ethereum-route',
  'europa-configured-route',
  'europa-dynamic-route',
]);

assert.equal(withDynamic.filter(candidate => candidate.chain === 'europa').length, 2);
console.log('Zero-capital configured Europa route retention verification passed');