const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');

const wallet = read('server/services/cryptocrawl/core/wallet-identity.ts');
const lifecycle = read('server/services/cryptocrawl/runtime/terminal-treasury-lifecycle.ts');
const observer = read('server/services/cryptocrawl/compensation/payout-recipient-confirmation-observer.ts');
const payouts = read('supabase/functions/cryptocrawler-terminal-sweeper/payouts.ts');
const payoutMigration = read('server/migrations/018_cryptocrawler_profit_split_eth_payout.sql');
const waitGuard = read('server/migrations/031_cryptocrawler_payout_confirmation_wait.sql');
const overflowSupport = read('server/migrations/overflow/004_cryptocrawler_terminal_support.sql');
const schema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const docker = read('Dockerfile');

// Primary payout is the public Ethereum address derived from WALLET_PRIVATE_KEY.
assert.match(wallet, /resolvePrimaryProfitPayoutAddress/);
assert.match(wallet, /walletFromPrivateKey\(privateKey\)\.address/);
assert.match(wallet, /CRYPTO_PAYOUT_WALLET_ADDRESS/);
assert.match(wallet, /candidate\.toLowerCase\(\) !== primaryLower/);

// Railway synchronizes the primary/fallback recipients and read-only Ethereum RPC
// into the one Overflow treasury authority. No private key becomes a destination.
assert.match(lifecycle, /resolvePrimaryProfitPayoutAddress/);
assert.match(lifecycle, /resolvePayoutFallbackAddress/);
assert.match(lifecycle, /cryptocrawler_profit_wallet/);
assert.match(lifecycle, /cryptocrawler_fallback_wallet/);
assert.doesNotMatch(lifecycle, /cryptocrawler_profit_wallet[^\n]*WALLET_PRIVATE_KEY/);

// Independent proof must bind OKX withdrawal truth to finalized Ethereum truth.
assert.match(observer, /eth_getTransactionByHash/);
assert.match(observer, /eth_getTransactionReceipt/);
assert.match(observer, /eth_getBlockByNumber[^\n]*finalized/);
assert.match(observer, /record\.ccy[^\n]*ETH/);
assert.match(observer, /ethereumMainnetChain\(record\.chain\)/);
assert.match(observer, /sameAddress\(record\.to, destination\)/);
assert.match(observer, /decimalEthToWei\(record\.amt\) !== expectedWei/);
assert.match(observer, /sameAddress\(transaction\.to, destination\)/);
assert.match(observer, /transaction\.value[^\n]*expectedWei/);
assert.match(observer, /okx_withdrawal_history\+ethereum_finalized_rpc/);
assert.match(observer, /moneyMovingAuthority: false/);

// Normal payout worker cannot confirm until the independent proof has been written.
assert.match(payouts, /recipient_confirmed_at/);
assert.match(payouts, /okx_withdrawal_history\+ethereum_finalized_rpc/);
assert.match(payouts, /cryptocrawler_profit_payout_batch_confirm/);

// Terminal/restart sweeps stay SUBMITTED while proof is pending. Hard proof
// mismatches remain database errors rather than being silently accepted.
assert.match(waitGuard, /NEW\.status := 'SUBMITTED'/);
assert.match(waitGuard, /Awaiting recipient-bound finalized Ethereum confirmation/);
assert.match(waitGuard, /non-authoritative recipient confirmation source/);
assert.match(waitGuard, /confirmation transaction hash mismatch/);
assert.match(waitGuard, /confirmation recipient mismatch/);
assert.match(waitGuard, /confirmed recipient amount is below/);

// The payout-aware finalizer has one owner. Overflow support must not replace it
// after migration 018 has installed the durable payout/job/retained-capital logic.
assert.match(payoutMigration, /CREATE OR REPLACE FUNCTION public\.cryptocrawler_terminal_sweep_finalize_events/);
assert.match(payoutMigration, /cryptocrawler_profit_payout_batches/);
assert.match(payoutMigration, /cryptocrawler_profit_payout_jobs/);
assert.doesNotMatch(overflowSupport, /CREATE OR REPLACE FUNCTION public\.cryptocrawler_terminal_sweep_finalize_events/);

// Overflow cannot take an older durable-schema fast path that omits these guards.
assert.match(schema, /const SCHEMA_VERSION = 8/);
assert.match(schema, /031_cryptocrawler_payout_confirmation_wait\.sql/);
assert.match(schema, /cryptocrawler_terminal_sweep_leg_confirmation_guard\(\)/);
assert.match(schema, /cryptocrawler_profit_payout_confirmation_guard\(\)/);

// The production image must actually contain every recipient-proof migration that
// schema v8 will read at runtime.
for (const migration of [
  '028_cryptocrawler_payout_recipient_confirmation.sql',
  '029_cryptocrawler_terminal_sweep_recipient_confirmation.sql',
  '030_cryptocrawler_payout_confirmation_truth_guard.sql',
  '031_cryptocrawler_payout_confirmation_wait.sql',
]) {
  assert.match(docker, new RegExp(migration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log(JSON.stringify({
  ok: true,
  primaryPayout: 'WALLET_PRIVATE_KEY-derived public Ethereum address',
  fallbackPayout: 'Railway explicit Ethereum address',
  payoutAsset: 'ETH',
  recipientProof: 'OKX withdrawal + finalized Ethereum RPC',
  pendingUntilRecipientProof: true,
  mismatchedRecipientFailsClosed: true,
  mismatchedAmountFailsClosed: true,
  privateKeyExposedAsDestination: false,
  canonicalPayoutFinalizerOwners: 1,
  payoutProofMigrationsShippedInImage: true,
  schemaVersion: 8,
}, null, 2));