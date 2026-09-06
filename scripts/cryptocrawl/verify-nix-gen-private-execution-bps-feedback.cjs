const assert = require('node:assert/strict');
const fs = require('node:fs');

const feedbackPath = 'server/services/cryptocrawl/intelligence/cex-private-execution-feedback.ts';
const transportPath = 'server/services/cryptocrawl/execution/cex-private-websocket-order-transport.ts';
const coinbaseStreamPath = 'server/services/cryptocrawl/intelligence/coinbase-private-execution-feedback.ts';
const coinbaseAuthorityPath = 'server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.ts';
const coinbaseSettlementPath = 'server/services/cryptocrawl/execution/coinbase-spot-settlement-adapter.ts';
const dockerPath = 'Dockerfile';

const feedback = fs.readFileSync(feedbackPath, 'utf8');
const transport = fs.readFileSync(transportPath, 'utf8');
const coinbaseStream = fs.readFileSync(coinbaseStreamPath, 'utf8');
const coinbaseAuthority = fs.readFileSync(coinbaseAuthorityPath, 'utf8');
const coinbaseSettlement = fs.readFileSync(coinbaseSettlementPath, 'utf8');
const docker = fs.readFileSync(dockerPath, 'utf8');

// Reuse the existing authenticated private order sockets for Kraken/OKX. No
// parallel execution or economics authority may be created for BPS feedback.
assert.match(transport, /consumePrivateCexExecutionFrame/);
assert.match(transport, /trackSubmittedPrivateCexOrder/);
assert.match(transport, /channel:\s*'executions'/);
assert.match(transport, /snap_orders:\s*false/);
assert.match(transport, /snap_trades:\s*false/);
assert.match(transport, /channel:\s*'orders',\s*instType:\s*'SPOT'/);
assert.match(transport, /submission_transport_plus_read_only_execution_feedback/);
assert.match(transport, /privateExecutionFeedbackAuthority:\s*'bps_revalidation_only'/);

// Coinbase retains its existing REST submission/settlement authority. The user
// WebSocket is authenticated by the same signer, is lazily started only after a
// concrete canonical REST submission, and subscribes only to user+heartbeats.
assert.match(coinbaseAuthority, /export function createCoinbaseWebSocketJwt/);
assert.match(coinbaseAuthority, /return signCoinbaseJwt\(\{\}, nowMs\)/);
assert.match(coinbaseStream, /wss:\/\/advanced-trade-ws-user\.coinbase\.com/);
assert.match(coinbaseStream, /channel:\s*'heartbeats'/);
assert.match(coinbaseStream, /channel:\s*'user'/);
assert.match(coinbaseStream, /consumePrivateCexExecutionFrame\('coinbase', payload\)/);
assert.match(coinbaseStream, /submissionAuthority:\s*'existing_rest_settlement_adapter_only'/);
assert.match(coinbaseStream, /signerAuthority:\s*'coinbase_advanced_trade_authority_only'/);
assert.match(coinbaseSettlement, /if \(this\.requester === coinbasePrivateRequest\) trackSubmittedPrivateCexOrder\(receipt\)/);
assert.doesNotMatch(coinbaseStream, /\/api\/v3\/brokerage\/orders/);
assert.doesNotMatch(coinbaseStream, /batch_cancel/);

// Private execution events are authenticated scheduling/wakeup evidence only.
// Terminal REST/authenticated settlement remains the realized P&L authority.
assert.match(feedback, /settlementAuthority:\s*false/);
assert.match(feedback, /economicBpsAuthority:\s*false/);
assert.match(feedback, /executionAuthority:\s*false/);
assert.doesNotMatch(feedback, /settlementAuthority:\s*true/);
assert.doesNotMatch(feedback, /economicBpsAuthority:\s*true/);
assert.doesNotMatch(feedback, /executionAuthority:\s*true/);
assert.match(feedback, /measuredOpportunityGraph\.revalidateSymbols\(\[symbol\]\)/);

// Coinbase snapshots may include every account order, but only order IDs already
// submitted by this process are admitted into BPS feedback. Stablecoin par is not
// assumed when normalizing pushed fees.
assert.match(feedback, /if \(!orderId \|\| !isTracked\('coinbase', orderId\)\) return null/);
assert.match(feedback, /row\.cumulative_quantity/);
assert.match(feedback, /row\.avg_price/);
assert.match(feedback, /row\.total_fees/);
assert.match(feedback, /quoteAsset === 'USD' \? totalFees : null/);

// OKX order-channel duplicates must not manufacture repeated fills/rebates, and
// venue-native fee sign must be normalized before advisory telemetry is exposed.
assert.match(feedback, /okx:trade:/);
assert.match(feedback, /okx:terminal:/);
assert.match(feedback, /feeAmountEconomic:\s*rawFee === null \? null : -rawFee/);
assert.match(feedback, /\['post_only', 'rpi'\]\.includes\(orderType\)/);

// Kraken execution reports retain the fields that matter to realized execution
// leakage: cumulative/last fill, average/last price, fee USD and maker/taker role.
assert.match(feedback, /row\.cum_qty/);
assert.match(feedback, /row\.last_qty/);
assert.match(feedback, /row\.avg_price/);
assert.match(feedback, /row\.last_price/);
assert.match(feedback, /fee_usd_equiv/);
assert.match(feedback, /row\.liquidity_ind === 'm'/);

// Bounded caches/cooldowns prevent a private update burst from turning into an
// unbounded BPS revalidation storm.
assert.match(feedback, /EVENT_CACHE_LIMIT/);
assert.match(feedback, /REVALIDATION_COOLDOWN_MS/);
assert.match(feedback, /revalidationCooldownUntil/);

// This verifier is part of the existing production Docker wildcard gate.
assert.match(docker, /verify-nix-gen-\*\.cjs/);

console.log(JSON.stringify({
  ok: true,
  verifier: 'private_execution_bps_feedback',
  privateExecutionState: 'coinbase_user_plus_kraken_executions_plus_okx_orders',
  economicBpsAuthority: false,
  settlementAuthority: false,
  executionAuthority: false,
  exactSymbolRevalidation: true,
  duplicateFillProtection: true,
  coinbaseTrackedOrdersOnly: true,
}));
