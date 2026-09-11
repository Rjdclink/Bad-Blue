'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server/services/cryptocrawl/capital-free/provider-mesh-pending-stream.ts', 'utf8');

for (const required of [
  "primaryTransport: 'canonical_rpc_manager_standard_pending_hashes'",
  "acceleratorTransport: 'drpc_public_full_pending_websocket'",
  'fallbackContinuouslyAvailable: true',
  'void this.ensureStandardFallback(network)',
  "'pending_transactions'",
  'FULL_PENDING_HANDSHAKE_TIMEOUT_MS',
  'socket.terminate()',
  "state.fallbackSubscription?.state === 'degraded'",
  'state.fallbackConnecting',
  'routeLocalFailure: true',
]) {
  assert.ok(source.includes(required), `Pending stream failover verifier missing: ${required}`);
}

assert.doesNotMatch(source, /state\.fallbackSubscription\?\.unsubscribe\(\).*state\.fallbackSubscription = null[\s\S]{0,200}message\.result/);
assert.match(source, /if \(state\.socket\?\.readyState === WebSocket\.OPEN && !!state\.subscriptionId\) return/);
assert.match(source, /multiProviderRpcManager\.subscribe\([\s\S]*'pending_transactions'/);
assert.match(source, /multiProviderRpcManager\.execute\([\s\S]*'transactions'/);

console.log('PENDING_STREAM_PROVIDER_FAILOVER_VERIFIED');
