'use strict';

const fs = require('node:fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing required Kraken parity file: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}

function mustMatch(path, text, pattern, message) {
  if (!pattern.test(text)) throw new Error(`${message} (${path})`);
}

const privateAuthorityPath = 'server/services/cryptocrawl/intelligence/cex-private-authority.ts';
const feeResolverPath = 'server/services/cryptocrawl/intelligence/cex-fee-resolver.ts';
const settlementPath = 'server/services/cryptocrawl/execution/cex-settlement.ts';
const exactSettlementPath = 'server/services/cryptocrawl/execution/cex-system-capital-settlement-evidence.ts';
const lotLedgerPath = 'server/services/cryptocrawl/execution/cex-system-owned-lot-ledger.ts';
const placementPath = 'server/services/cryptocrawl/execution/cex-system-capital-placement.ts';
const treasuryPath = 'server/services/cryptocrawl/execution/cex-treasury-transfer-worker.ts';
const sweepPath = 'server/services/cryptocrawl/execution/system-capital-sweep-worker.ts';
const retainedPath = 'server/services/cryptocrawl/compensation/retained-profit-ledger.ts';
const learningPath = 'server/services/cryptara/venue-specialization-learning.ts';
const livePriorityPath = 'server/services/cryptocrawl/optimization/nix-gen/live-priority-registry.ts';
const rainbowPath = 'server/services/cryptocrawl/runtime/rainbow-profit-bridge-wiring.ts';
const makerAmendPath = 'server/services/cryptocrawl/execution/kraken-maker-queue-amend.ts';

const privateAuthority = read(privateAuthorityPath);
const feeResolver = read(feeResolverPath);
const settlement = read(settlementPath);
const exactSettlement = read(exactSettlementPath);
const lotLedger = read(lotLedgerPath);
const placement = read(placementPath);
const treasury = read(treasuryPath);
const sweep = read(sweepPath);
const retained = read(retainedPath);
const learning = read(learningPath);
const livePriority = read(livePriorityPath);
const rainbow = read(rainbowPath);
const makerAmend = read(makerAmendPath);

// Authenticated transport and account-measured fee authority.
must(privateAuthorityPath, privateAuthority, 'krakenPrivateRequest', 'Kraken must retain one authenticated private-request authority');
must(privateAuthorityPath, privateAuthority, 'nextKrakenNonce()', 'Kraken private requests must retain monotonic nonce authority');
must(privateAuthorityPath, privateAuthority, 'serializeKrakenPrivate', 'Kraken private requests must remain serialized through the canonical nonce lane');
must(feeResolverPath, feeResolver, "'/0/private/TradeVolume'", 'Kraken fee economics must come from authenticated account TradeVolume evidence');
must(feeResolverPath, feeResolver, "source: 'kraken_account_trade_volume'", 'Kraken fee provenance must remain explicit');

// First-class trade submission and terminal settlement.
must(settlementPath, settlement, "export type ExecutableCexVenue = 'coinbase' | 'kraken' | 'okx'", 'Kraken must remain a canonical executable CEX venue');
must(settlementPath, settlement, 'class KrakenSettlementAdapter implements CexSettlementAdapter', 'Kraken must retain its production settlement adapter');
must(settlementPath, settlement, "'/0/private/AddOrder'", 'Kraken must retain authenticated order submission');
must(settlementPath, settlement, "'/0/private/QueryOrders'", 'Kraken must retain authenticated terminal order-state recovery');
must(settlementPath, settlement, "'/0/private/QueryTrades'", 'Kraken must retain authenticated fill-level settlement evidence');
must(settlementPath, settlement, "'/0/private/CancelOrder'", 'Kraken must retain canonical cancellation authority');

// Kraken-specific maker strength remains an optimization, never a second authority.
must(makerAmendPath, makerAmend, 'export class KrakenMakerQueueAmendController', 'Kraken queue-preserving amend specialization must remain available');
must(makerAmendPath, makerAmend, 'economicBpsAuthority: false', 'Kraken queue intelligence must not invent economic BPS');
must(makerAmendPath, makerAmend, 'settlementAuthority: false', 'Kraken queue intelligence must not become settlement authority');

// Exact system-capital ownership is fill-derived, not account-balance-derived.
must(exactSettlementPath, exactSettlement, 'getExactKrakenOrderAssetDeltas', 'Kraken system-owned execution must retain exact authenticated settlement evidence');
must(exactSettlementPath, exactSettlement, "'/0/private/QueryTrades'", 'Kraken exact ownership evidence must use authenticated trade records');
must(exactSettlementPath, exactSettlement, 'query_trades_batched_at_20', 'Kraken exact settlement must retain bounded QueryTrades batching');
must(lotLedgerPath, lotLedger, "type SystemOwnedCexVenue = 'coinbase' | 'okx' | 'kraken'", 'Kraken must remain part of the exact system-owned lot authority');
must(lotLedgerPath, lotLedger, 'SYSTEM_CAPITAL_PROVENANCE_DEFICIT', 'Kraken must fail closed rather than spending unowned account balance');
must(lotLedgerPath, lotLedger, "WHERE venue=$1 AND asset=$2 AND status='ACTIVE'", 'Kraken spendability must remain limited to ACTIVE system-owned lots');

// Retained-capital and payout-funding movement must include Kraken where supported.
must(treasuryPath, treasury, "type Venue = 'coinbase' | 'kraken' | 'okx'", 'Kraken must remain a treasury venue');
must(treasuryPath, treasury, 'resolveKrakenDeposit', 'Kraken must retain authenticated destination discovery');
must(treasuryPath, treasury, "'/0/private/DepositMethods'", 'Kraken transfer routing must inspect authenticated deposit methods');
must(treasuryPath, treasury, "'/0/private/DepositAddresses'", 'Kraken transfer routing must inspect authenticated deposit addresses');
must(treasuryPath, treasury, 'recoverKrakenWithdrawal', 'Kraken ambiguous withdrawals must recover before any resubmission');
must(treasuryPath, treasury, "'/0/private/WithdrawInfo'", 'Kraken withdrawal economics must use authenticated fee/net evidence');
must(treasuryPath, treasury, "'/0/private/WithdrawStatus'", 'Kraken withdrawal settlement must be terminally reconciled');
must(treasuryPath, treasury, 'cryptocrawler_confirm_payout_funding_transfer', 'Kraken payout funding must remain separate from system-owned trading capital');

must(sweepPath, sweep, "type Venue = 'kraken' | 'okx'", 'Kraken must remain an active system-capital sweep venue');
must(sweepPath, sweep, 'Kraken sweep withdrawal delivered less than the persisted 80% wallet target', 'Kraken sweep must preserve exact payout-target verification');
must(sweepPath, sweep, 'verifyFinalizedRecipient', 'Kraken-origin ETH payout must still require finalized Ethereum recipient proof');

must(retainedPath, retained, "['coinbase', 'kraken', 'okx'].includes", 'Kraken must remain eligible as a terminal payout/retained-capital source');
must(retainedPath, retained, "source === 'kraken' && target === 'okx'", 'Kraken-to-OKX retained-capital routing must remain supported');
must(retainedPath, retained, "source === 'okx' && target === 'kraken'", 'OKX-to-Kraken retained-capital routing must remain supported');

// Nix-Gen and Cryptara may rank Kraken but never gain execution/economics authority.
must(learningPath, learning, "export type CryptaraVenue = 'coinbase' | 'kraken' | 'okx'", 'Cryptara must learn Kraken specialization alongside Coinbase and OKX');
must(learningPath, learning, "new Set<CryptaraVenue>(['coinbase', 'kraken', 'okx'])", 'Kraken must remain in Cryptara supported venue learning');
must(learningPath, learning, 'executionAuthority: false', 'Cryptara venue learning must not become execution authority');
must(learningPath, learning, 'canonicalEconomicsAuthority: false', 'Cryptara venue learning must not replace canonical economics');
must(livePriorityPath, livePriority, "export type NixGenCexVenue = 'coinbase' | 'kraken' | 'okx'", 'Nix-Gen venue demand must retain Kraken');
must(livePriorityPath, livePriority, '/^cex:venue:(coinbase|kraken|okx)$/.exec', 'Nix-Gen must recognize Kraken resource demand from actual executable bids');
must(rainbowPath, rainbow, "retainedCapitalCexRoutingTargets: ['coinbase', 'kraken', 'okx']", 'Rainbow must expose Kraken as a first-class retained-capital CEX target');
mustMatch(rainbowPath, rainbow, /payoutAuthority:\s*'[^']*kraken[^']*payout_funding[^']*'/, 'Rainbow payout telemetry must retain the Kraken payout-funding lane');

// Direct on-chain -> Kraken seeding is the one deliberately unresolved parity seam.
// It must remain visibly fail-closed until authenticated funding metadata can prove
// source network compatibility and exchange-side terminal credit by transaction hash.
must(placementPath, placement, "type CexCapitalVenue = 'okx' | 'kraken'", 'Kraken must remain represented in the system-capital placement surface');
must(placementPath, placement, "if (validated.venue === 'kraken')", 'Kraken direct placement must remain an explicit governed branch');
must(placementPath, placement, 'Kraken CEX seeding remains fail-closed until its authenticated funding method proves exact source-network compatibility and exchange-side deposit status by transaction hash', 'Unproven direct Kraken placement must never silently become spendable');

console.log('NIX-GEN KRAKEN FIRST-CLASS PARITY VERIFIER PASSED');
