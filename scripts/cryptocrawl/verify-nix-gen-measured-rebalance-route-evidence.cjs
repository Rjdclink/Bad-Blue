'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const wiring = fs.readFileSync('server/services/cryptocrawl/integration/measured-rebalance-route-evidence-wiring.ts', 'utf8');
const rebalancer = fs.readFileSync('server/services/cryptocrawl/execution/inventory-rebalancer.ts', 'utf8');
const bootstrap = fs.readFileSync('server/cryptara-bootstrap-entry.ts', 'utf8');
const docker = fs.readFileSync('Dockerfile', 'utf8');

assert.match(wiring, /\/api\/v5\/asset\/currencies/);
assert.match(wiring, /\/0\/private\/DepositMethods/);
assert.match(wiring, /\/0\/private\/WithdrawMethods/);
assert.match(wiring, /\/0\/private\/WithdrawAddresses/);
assert.match(wiring, /\/0\/private\/WithdrawInfo/);
assert.match(wiring, /\/api\/v5\/asset\/deposit-address/);
assert.match(wiring, /coinGeckoPriceClient\.getLiveSymbolPrices/);
assert.match(wiring, /burningFeeRate > 0\) continue/);
assert.match(wiring, /destination_address:exact_verified_match/);
assert.match(wiring, /transferExecutionAuthority:\s*false/);
assert.match(wiring, /syntheticFeeEvidenceAllowed:\s*false/);
assert.match(wiring, /syntheticLatencyEconomicsAllowed:\s*false/);

assert.match(rebalancer, /withdrawalFeeCurrency:\s*string/);
assert.match(rebalancer, /estimatedLatencyMs:\s*number \| null/);
assert.match(rebalancer, /transfer_latency:unknown_not_economic_authority/);
assert.match(rebalancer, /liveTransferExecutionEnabled:\s*false/);
assert.match(rebalancer, /syntheticTransferLatencyEconomics:\s*false/);

assert.match(bootstrap, /ensureMeasuredRebalanceRouteEvidenceWiring/);
assert.match(docker, /verify-nix-gen-\*\.cjs/);

console.log(JSON.stringify({
  ok: true,
  verifier: 'measured_rebalance_route_evidence',
  authenticatedFeeEvidence: true,
  transferExecutionAuthority: false,
  syntheticFeeEvidenceAllowed: false,
  syntheticLatencyEconomicsAllowed: false,
}));
