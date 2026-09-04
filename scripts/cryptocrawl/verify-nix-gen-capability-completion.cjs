const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`NIX_GEN_CAPABILITY_COMPLETION_MISSING: ${label}`);
}
function mustNot(text, needle, label) {
  if (text.includes(needle)) throw new Error(`NIX_GEN_CAPABILITY_COMPLETION_REGRESSION: ${label}`);
}
function mustBefore(text, first, second, label) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    throw new Error(`NIX_GEN_CAPABILITY_COMPLETION_ORDERING: ${label}`);
  }
}

const index = read('server/services/cryptocrawl/optimization/nix-gen/index.ts');
const bids = read('server/services/cryptocrawl/optimization/nix-gen/canonical-bid-adapters.ts');
const live = read('server/services/cryptocrawl/optimization/nix-gen/live-priority-registry.ts');
const globalLive = read('server/services/cryptocrawl/optimization/nix-gen/global-live-portfolio.ts');
const zeroOrdering = read('server/services/cryptocrawl/optimization/nix-gen/zero-capital-ordering.ts');
const zeroWiring = read('server/services/cryptocrawl/integration/zero-capital-shadow-priority-wiring.ts');
const cexOrdering = read('server/services/cryptocrawl/optimization/nix-gen/cex-ordering.ts');
const measuredOrdering = read('server/services/cryptocrawl/optimization/nix-gen/measured-portfolio-preparation.ts');
const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const crossEconomics = read('server/services/cryptocrawl/discovery/cross-chain-route-economics.ts');
const crossLifecycle = read('server/services/cryptocrawl/execution/cross-chain-durable-lifecycle.ts');
const crossTerminal = read('server/services/cryptocrawl/bridge/across-terminal-amount-evidence.ts');
const acrossExecutor = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const acrossPrebroadcast = read('server/services/cryptocrawl/execution/across-prebroadcast-durability.ts');
const crossMigration = read('server/migrations/043_cryptocrawler_cross_chain_lifecycle.sql');
const canonicalScheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const fundingLifecycle = read('server/services/cryptocrawl/execution/funding-position-lifecycle.ts');
const fundingAdapter = read('server/services/cryptocrawl/execution/okx-funding-lifecycle-adapter.ts');
const fundingCapital = read('server/services/cryptocrawl/execution/funding-capital-reservation.ts');
const combinedAdapter = read('server/services/cryptocrawl/execution/funding-crosschain-execution-adapter.ts');
const manifest = read('server/services/cryptocrawl/optimization/nix-gen/completion-manifest.ts');

must(index, "./zero-capital-ordering.js", 'zero-capital ordering is exported');
must(index, "./live-priority-registry.js", 'shared live priority registry is exported');

must(bids, "strategyClass: 'market_making'", 'maker CEX plans map to the market-making finger');
must(bids, "zero_capital_engine:dispatchExecutableOpportunities", 'zero-capital authoritative execution path is explicit');
must(bids, "zero_capital_engine:terminal_realized_profit_wiring", 'zero-capital terminal settlement capability authority is explicit');

must(zeroWiring, 'orderZeroCapitalOpportunitiesWithNixGen', 'existing zero-capital queue consumes Nix-Gen ordering');
must(zeroWiring, 'applyPreviousResourceShadowOrdering', 'previous zero-capital ordering remains fail-open fallback');
must(zeroWiring, 'executionAuthorityChanged: false', 'zero-capital Nix-Gen wiring does not acquire execution authority');

must(live, "authority: 'nix_gen_shared_live_priority_registry'", 'shared global live priority authority is explicit');
must(live, 'executionAuthority: false', 'shared registry cannot execute');
must(live, 'resourceAuthority: false', 'shared registry cannot acquire resources');
must(live, 'filtersCanonicalCandidates: false', 'shared registry cannot filter canonical candidates');
must(cexOrdering, "source: 'cex'", 'CEX lane publishes to global live priority');
must(measuredOrdering, "source: 'measured_atomic'", 'measured deterministic lane publishes to global live priority');
must(zeroOrdering, "source: 'zero_capital'", 'zero-capital lane publishes to global live priority');

must(globalLive, 'additionalPrepared?: readonly NixGenPreparedBid[]', 'pure global helper accepts already-prepared independent live lanes');
must(globalLive, 'additionalPreparedCount: number', 'pure global helper reports additional live-lane participation');
must(globalLive, 'filtersCanonicalCandidates: false', 'pure global helper remains non-filtering');

// Cross-chain is eligible only from a closed same-asset deterministic value loop.
must(crossChain, 'cross_chain_profit_model:same_asset_closed_value', 'cross-chain uses closed same-asset value accounting');
must(crossChain, 'cross_chain_profit_model:minimum_output_not_expected_output', 'cross-chain uses guaranteed minimum rather than optimistic expected output');
must(crossChain, 'executableCapability: routeExecutable', 'cross-chain capability is derived from complete route evidence');
must(crossEconomics, 'guaranteedOutputHuman', 'cross-chain deterministic economics are based on guaranteed output');
must(crossEconomics, 'deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd', 'origin gas is subtracted exactly once');
must(crossTerminal, 'if (inputAmount !== quote.inputAmount) return null;', 'terminal deposit amount must match execution quote input');
must(crossLifecycle, 'applyCrossChainSystemCapitalSettlement', 'terminal cross-chain settlement reconciles system-owned capital');
must(crossLifecycle, "status: 'ACCOUNTING_PENDING'", 'missing terminal accounting evidence remains pending instead of fabricating settlement');

// The exact origin transaction is durable before any Across principal broadcast.
must(crossMigration, 'signed_origin_tx text', 'cross-chain lifecycle stores exact signed origin transaction bytes');
must(crossMigration, 'origin_fee_complete boolean NOT NULL DEFAULT false', 'cross-chain lifecycle distinguishes approval-only gas from complete origin gas');
must(crossMigration, "'PREPARED'", 'cross-chain lifecycle has a pre-broadcast durable state');
must(crossMigration, "WHERE status IN ('FILLED','REFUNDED','FAILED')", 'origin failures participate in durable terminal feedback');
must(crossMigration, 'had_origin_fee_complete boolean', 'migration detects the one-time legacy schema transition');
must(crossMigration, 'IF NOT had_origin_fee_complete THEN', 'legacy broadcast backfill cannot rerun against new live handoffs');
must(crossMigration, 'broadcast_at = COALESCE(broadcast_at, submitted_at)', 'legacy lifecycle rows are marked as already broadcast');
must(crossMigration, 'DROP CONSTRAINT IF EXISTS cryptocrawler_cross_chain_lifecycles_status_check', 'legacy status check is upgraded idempotently');
must(crossMigration, 'CREATE OR REPLACE FUNCTION public.cryptocrawler_pin_cross_chain_reservation()', 'unresolved cross-chain capital has database-level pinning authority');
must(crossMigration, "SET expires_at = 'infinity'::timestamptz", 'unresolved cross-chain reservation cannot silently expire');
must(crossMigration, 'AFTER INSERT OR UPDATE OF status, reservation_id', 'new lifecycle rows pin their exact reservation immediately');
must(crossMigration, "lifecycle.status IN ('PREPARED','SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED')", 'existing unresolved lifecycle rows are backfilled into pinned reservations');
must(acrossExecutor, "error: 'REJECT_ACROSS_DURABILITY_CALLBACK_REQUIRED'", 'Across principal execution requires durable lifecycle authority');
must(acrossExecutor, 'signedOriginTx = await wallet.signTransaction(populated);', 'Across origin transaction is signed before broadcast');
must(acrossExecutor, 'depositTxnRef = ethers.utils.keccak256(signedOriginTx).toLowerCase();', 'Across recovery identity is the exact signed transaction hash');
must(acrossExecutor, 'await armPreparedAcrossOriginTransaction({ depositTxnRef, signedOriginTx, preparedAt });', 'signed origin transaction is durably armed before broadcast');
must(acrossExecutor, 'submitted = await provider.sendTransaction(signedOriginTx);', 'principal broadcast uses the exact durable signed transaction');
mustBefore(acrossExecutor, 'await options.onSubmitted({', 'await armPreparedAcrossOriginTransaction({ depositTxnRef, signedOriginTx, preparedAt });', 'lifecycle row must exist before signed transaction is armed');
mustBefore(acrossExecutor, 'await armPreparedAcrossOriginTransaction({ depositTxnRef, signedOriginTx, preparedAt });', 'submitted = await provider.sendTransaction(signedOriginTx);', 'signed transaction must be durable before principal broadcast');
must(acrossExecutor, 'duplicateSubmissionAllowed: false', 'ambiguous broadcast explicitly forbids duplicate principal submission');
must(acrossPrebroadcast, 'ethers.utils.keccak256(raw).toLowerCase() !== hash', 'recovery rejects signed bytes whose hash differs from durable identity');
must(acrossPrebroadcast, "WHERE (status='PREPARED' OR (status='SUBMITTED' AND origin_fee_complete=false))", 'restart worker recovers both armed and pre-arm durable rows');
must(acrossPrebroadcast, 'const rebroadcast = await provider.sendTransaction(raw);', 'recovery can only rebroadcast the exact durable signed transaction');
must(acrossPrebroadcast, "return finalizeOriginFailure(row, row.originNativeFeeWei, 'ACROSS_PREBROADCAST_NOT_BROADCAST');", 'proven pre-broadcast crashes terminally release untouched principal');
must(acrossPrebroadcast, 'WITH released AS (', 'origin failure releases reservation and writes terminal state atomically');
must(acrossPrebroadcast, "if (receipt.status !== 1) return finalizeOriginFailure(row, feeWei, 'ACROSS_ORIGIN_DEPOSIT_REVERTED');", 'origin revert is terminal realized gas-loss evidence');
must(acrossPrebroadcast, 'duplicateSubmissionAllowed: false', 'recovery explicitly denies second principal submission');
mustNot(acrossPrebroadcast, "pool.query('BEGIN')", 'pooled queries cannot impersonate a pinned database transaction');
mustNot(acrossPrebroadcast, 'WALLET_PRIVATE_KEY', 'prebroadcast recovery does not read signer secrets');
mustNot(acrossPrebroadcast, 'setInterval(', 'prebroadcast recovery cannot create a competing timer');
must(combinedAdapter, 'advancePreparedAcrossOriginTransactions(limit)', 'existing scheduler cadence advances prebroadcast recovery');
must(combinedAdapter, 'claimPendingAcrossOriginFailureFeedback', 'origin failures enter durable terminal feedback');
must(combinedAdapter, "if (result.status === 'REFUNDED') return 'refunded';", 'cross-chain terminal mapping preserves refund truth');
must(combinedAdapter, "return 'failed';", 'origin failures are recorded as failed terminal executions');
must(combinedAdapter, "const submitted = (result.status === 'opened' || result.status === 'opening') && Boolean(result.lifecycleId);", 'ambiguous funding opening consumes the parent submission slot');
must(canonicalScheduler, 'await fundingCrossChainExecutionAdapter.advanceOpenFundingLifecycles(4);', 'long-lived lifecycle recovery runs on the canonical scheduler cadence');
mustBefore(canonicalScheduler, 'await fundingCrossChainExecutionAdapter.advanceOpenFundingLifecycles(4);', "if (!isLiveExecutionPosture())", 'lifecycle recovery runs before new-exposure posture gates');

// Funding entry remains projected expected value. Only authenticated terminal fills/bills establish realized profit.
must(funding, 'deterministicNetProfitUsd: null', 'funding discovery never writes projected carry into deterministic profit');
must(funding, 'funding_profit_authority:projected_expected_value_until_terminal_bill', 'funding projected-profit boundary is explicit');
must(fundingLifecycle, 'Expected-value carry at entry. This is not canonical deterministic profit.', 'funding plan type preserves projected-vs-deterministic distinction');
must(fundingLifecycle, 'reconcileSettlement?', 'funding lifecycle can recover delayed terminal bill evidence');
must(fundingAdapter, "okx_authenticated_funding_bills:type_8", 'terminal funding economics use authenticated funding bills');
must(fundingAdapter, 'cex_system_owned_lot_ledger:exact_spot_and_derivative_transforms', 'funding terminal ownership uses exact system-owned ledger transforms');
must(combinedAdapter, 'funding_projected_entry_vs_realized_terminal_separated', 'terminal feedback preserves projected-vs-realized separation');

// Ambiguous exchange state must never create a capital release or a duplicate/emergency order.
must(fundingAdapter, "if (error instanceof OkxPrivateApiError && String(error.code) === '51603') return { state: 'absent' };", 'only explicit OKX OrderNotFound proves client-order absence');
must(fundingAdapter, "throw new Error('FUNDING_ENTRY_ORDER_STATE_UNCERTAIN')", 'uncertain entry state remains in durable recovery');
must(fundingAdapter, 'emergencyNeutralizationAuthorized: false', 'ambiguous state explicitly denies emergency resubmission');
must(fundingAdapter, 'capitalReleased: false', 'ambiguous state explicitly retains capital');
must(fundingAdapter, "error: 'FUNDING_CLOSE_ORDER_STATE_UNCERTAIN'", 'uncertain close state remains settlement-unknown');
must(fundingAdapter, "return { status: 'pending', error: 'FUNDING_ENTRY_PARTIAL_TERMINAL_EXPOSURE_RECONCILIATION_REQUIRED' };", 'abnormal terminal partial entry cannot be full-size neutralized blindly');
mustNot(fundingAdapter, 'spotExposureOpen: spotClosed?.filled !== true', 'unknown close state cannot be interpreted as open exposure');
mustNot(fundingAdapter, 'perpExposureOpen: perpClosed?.filled !== true', 'unknown close state cannot be interpreted as open exposure');

// Once close or settlement recovery begins, the lifecycle may never resume normal carry.
must(fundingLifecycle, "const closeRecoveryRequired = activeStatus === 'closing' || activeStatus === 'settlement_unknown';", 'closing and settlement-unknown states are one-way recovery states');
must(fundingLifecycle, 'const healthy = closeRecoveryRequired ? false : await adapter.marginHealthy(receipt).catch(() => false);', 'close recovery cannot be reclassified as a healthy carry position');
must(fundingLifecycle, "? 'close_or_settlement_recovery'", 'recovery close reason remains explicit');
mustNot(fundingLifecycle, "activeStatus !== 'closing'", 'settlement-unknown cannot fall through the old healthy-carry gate');

// Terminal capital release is strictly downstream of complete authenticated accounting.
must(fundingAdapter, 'function terminalFundingAccountingComplete', 'terminal funding accounting completeness has one explicit predicate');
must(fundingAdapter, "throw new Error('FUNDING_CAPITAL_RELEASE_REQUIRES_COMPLETE_TERMINAL_ACCOUNTING')", 'capital release helper fails closed without complete terminal accounting');
must(fundingAdapter, 'if (!terminalFundingAccountingComplete(settlement)) return settlement;', 'pending terminal accounting retains the funding hold');
must(fundingAdapter, 'await releaseTerminalFundingCapitalHold(okx, reconciledReceipt, settlement);', 'funding hold release occurs only through the terminal-accounting gate');
must(fundingAdapter, 'funding_capital_hold_retained_until_terminal_accounting', 'delayed funding bills explicitly retain capital');
must(fundingAdapter, "capitalReleaseAuthority: 'complete_terminal_accounting_only'", 'adapter declares complete terminal accounting as release authority');

// Reservation expiry itself must not bypass terminal-accounting ownership protection.
must(fundingCapital, 'function terminalAccountingRecoveryHoldMs', 'funding reservations have a bounded terminal-accounting recovery horizon');
must(fundingCapital, 'const durableHoldUntil = Math.max(input.holdUntil, Date.now() + terminalAccountingRecoveryHoldMs());', 'initial funding reservations cover terminal-accounting recovery');
must(fundingCapital, 'SET expires_at=GREATEST(expires_at,to_timestamp($3/1000.0))', 'renewal can never shorten a durable funding reservation');
must(fundingCapital, 'holdUntil: durableExpiry', 'restart recovery preserves the durable reservation expiry');
must(fundingCapital, '30 * 24 * 60 * 60_000', 'recovery horizon remains bounded rather than permanent');

// Nix deterministic-dollar allocation may include deterministic cross-chain, never projected funding carry.
must(measuredOrdering, "decision.topology === 'CROSS_CHAIN'", 'deterministic cross-chain enters measured Nix portfolio');
mustNot(measuredOrdering, "decision.topology === 'FUNDING_ARBITRAGE'", 'projected funding must not enter deterministic Nix portfolio');

must(manifest, "cross_chain_live_finger', state: 'implemented'", 'manifest records cross-chain finger completion');
must(manifest, "funding_rate_live_finger', state: 'implemented'", 'manifest records funding lifecycle completion');
must(manifest, 'entry carry remains projected expected value', 'manifest preserves funding deterministic-profit boundary');

for (const text of [bids, live, globalLive, zeroOrdering, measuredOrdering]) {
  mustNot(text, 'WALLET_PRIVATE_KEY', 'Nix-Gen capability layer must not access signer secrets');
  mustNot(text, '.sendTransaction(', 'Nix-Gen capability layer must not submit transactions');
  mustNot(text, '.transfer(', 'Nix-Gen capability layer must not move funds');
}

console.log('NIX_GEN_CAPABILITY_COMPLETION_OK');
