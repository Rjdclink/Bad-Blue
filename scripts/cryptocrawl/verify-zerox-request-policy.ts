import assert from 'node:assert/strict';
import { resolveZeroXRequestPolicy } from '../../server/services/cryptocrawl/intelligence/zerox-request-policy.js';

const validTaker = '0x1111111111111111111111111111111111111111';

const discoveryWithoutTaker = resolveZeroXRequestPolicy({});
assert.equal(discoveryWithoutTaker.allowed, true);
assert.equal(discoveryWithoutTaker.endpoint, 'price');
assert.equal(discoveryWithoutTaker.includeTaker, false);

const discoveryWithConfiguredTaker = resolveZeroXRequestPolicy({
  purpose: 'discovery',
  takerAddress: validTaker,
});
assert.equal(discoveryWithConfiguredTaker.allowed, true);
assert.equal(discoveryWithConfiguredTaker.endpoint, 'price');
assert.equal(discoveryWithConfiguredTaker.includeTaker, false);
assert.equal(discoveryWithConfiguredTaker.takerAddress, null);

const executionWithoutTaker = resolveZeroXRequestPolicy({ purpose: 'execution' });
assert.equal(executionWithoutTaker.allowed, false);
assert.equal(executionWithoutTaker.endpoint, 'quote');
assert.equal(executionWithoutTaker.includeTaker, false);

const executionWithInvalidTaker = resolveZeroXRequestPolicy({
  purpose: 'execution',
  takerAddress: 'not-an-address',
});
assert.equal(executionWithInvalidTaker.allowed, false);

const executionWithValidTaker = resolveZeroXRequestPolicy({
  purpose: 'execution',
  takerAddress: validTaker,
});
assert.equal(executionWithValidTaker.allowed, true);
assert.equal(executionWithValidTaker.endpoint, 'quote');
assert.equal(executionWithValidTaker.includeTaker, true);
assert.equal(executionWithValidTaker.takerAddress, validTaker);

console.log('0x request-purpose policy verification passed');
