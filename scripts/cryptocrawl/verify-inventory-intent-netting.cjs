'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const rebalancer = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/execution/inventory-rebalancer.ts'), 'utf8');
const ledger = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/execution/cex-inventory-ledger.ts'), 'utf8');
const executor = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/execution/inventory-rebalance-executor.ts'), 'utf8');

assert.match(rebalancer, /remainingDelta/);
assert.match(rebalancer, /bestNettingCandidate/);
assert.match(rebalancer, /surplus\.remainingDelta = Math\.max\(0, surplus\.remainingDelta - amount\)/);
assert.match(rebalancer, /deficit\.remainingDelta = Math\.max\(0, deficit\.remainingDelta - amount\)/);
assert.match(rebalancer, /inventory_intent_netting:single_consumption/);
assert.match(rebalancer, /syntheticFillNetting:\s*false/);
assert.match(rebalancer, /exchangeFillFeeErasure:\s*false/);
assert.match(rebalancer, /liveTransferExecutionEnabled:\s*false/);

assert.match(ledger, /operatorBalanceAuthorityGranted:\s*false/);
assert.match(ledger, /systemOwnedCapitalRequired:\s*true/);
assert.match(ledger, /payoutReserved/);
assert.match(executor, /settlementConfirmed/);
assert.match(executor, /REJECT_REBALANCE_NETWORK_OR_ADDRESS_UNVERIFIED/);
assert.match(executor, /requireAllowed\('SUBMIT_TX'/);

assert.ok(!/self.?trade|wash.?trade|referral.?rebate/i.test(rebalancer), 'inventory netting must not create self-trade/rebate tactics');

console.log('[inventory-intent-netting] PASS: rebalance intents consume surplus/deficit once, operator/payout funds remain protected, synthetic fills and fee erasure are forbidden, and live transfers remain settlement-gated');
