import assert from 'node:assert/strict';
import { resolveRpcFallbackAdmission } from '../../server/services/cryptocrawl/runtime/rpc-fallback-policy.js';

const configured = resolveRpcFallbackAdmission({
  configuredUrl: 'https://configured.example/rpc',
  publicUrl: 'https://public.example/rpc',
  allowPublicFallback: false,
});
assert.equal(configured.source, 'configured');
assert.equal(configured.endpoint, 'https://configured.example/rpc');
assert.equal(configured.priority, 8);

const defaultPublic = resolveRpcFallbackAdmission({
  publicUrl: 'https://public.example/rpc',
  allowPublicFallback: false,
});
assert.equal(defaultPublic.source, 'disabled');
assert.equal(defaultPublic.endpoint, null);

const optedIn = resolveRpcFallbackAdmission({
  publicUrl: 'https://public.example/rpc',
  allowPublicFallback: true,
});
assert.equal(optedIn.source, 'public_opt_in');
assert.equal(optedIn.endpoint, 'https://public.example/rpc');
assert.equal(optedIn.priority, 2);

const none = resolveRpcFallbackAdmission({
  allowPublicFallback: true,
});
assert.equal(none.source, 'disabled');
assert.equal(none.endpoint, null);

console.log('RPC fallback admission verification passed');
