import { ethers, providers } from 'ethers';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { recordGhostWalletPerformance } from './ghost-wallet-performance-intelligence.js';
import { enqueueGhostWalletWork, upsertGhostWalletVenue } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';
import { recordGhostWalletRuntimeState } from './ghost-wallet-runtime-state.js';

const EVENT_INTERFACE = new ethers.utils.Interface([
  'event AtomicCreditSettled(address indexed source,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
  'event AtomicLiabilityCycleSettled(address indexed liabilityOracle,bytes32 indexed liabilityQueryHash,address indexed profitAsset,uint256 startingLiability,uint256 endingLiability,uint256 realizedProfit,address profitRecipient)',
  'event MatchedIntentPairSettled(address indexed ownerA,address indexed ownerB,address tokenA,address tokenB,uint256 feeA,uint256 feeB,address profitRecipient)',
  'event VaultCreditSettled(address indexed vault,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
  'event BrokeredAtomicCreditSettled(address indexed vault,address indexed borrower,address indexed asset,uint256 principal,uint256 sourceFee,uint256 borrowerFee,uint256 realizedSpread,address profitRecipient)',
  'event ExternalCreditBrokered(address indexed lender,address indexed borrower,address indexed token,uint256 principal,uint256 upstreamFee,uint256 borrowerFee,uint256 realizedSpread,address profitRecipient,address initiator,uint8 upstreamKind)',
]);

const PROFIT_SPLIT_DENOMINATOR = 10n;
const RETAINED_SPLIT_NUMERATOR = 1n;

function addr(value: unknown): string { return ethers.utils.getAddress(String(value)); }
function amount(value: unknown): bigint { return BigInt(ethers.BigNumber.from(value as any).toString()); }
function upstreamProtocol(kind: number): string {
  if (kind === 1) return 'erc3156';
  if (kind === 2) return 'aave_v3';
  if (kind === 3) return 'morpho_blue';
  if (kind === 4) return 'balancer_v2';
  return 'unknown_atomic_lender';
}

function splitRealizedProfit(realized: bigint): { payout: bigint; retained: bigint } {
  if (realized <= 0n) return { payout: 0n, retained: 0n };
  const retained = (realized * RETAINED_SPLIT_NUMERATOR) / PROFIT_SPLIT_DENOMINATOR;
  const payout = realized - retained;
  return { payout, retained };
}

async function enqueueProfit(input: {
  chain: string;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  asset: string;
  amount: bigint;
  sourceKind: string;
}): Promise<boolean> {
  if (input.amount <= 0n) return false;
  const allocation = splitRealizedProfit(input.amount);
  if (allocation.payout <= 0n) return false;
  await enqueueGhostWalletWork({
    dedupeKey: `ghost-profit:${input.transactionHash.toLowerCase()}:${input.logIndex}:${input.asset.toLowerCase()}:${input.amount}`,
    kind: 'profit_conversion',
    chain: input.chain,
    priority: 2_000,
    maxAttempts: 48,
    profitAsset: input.asset,
    profitAmountBaseUnits: allocation.payout,
    payload: {
      sourceTransactionHash: input.transactionHash,
      sourceBlockNumber: input.blockNumber,
      chain: input.chain,
      asset: input.asset,
      amountBaseUnits: allocation.payout.toString(),
      realizedProfitBaseUnits: input.amount.toString(),
      payoutAmountBaseUnits: allocation.payout.toString(),
      retainedAmountBaseUnits: allocation.retained.toString(),
      payoutFractionBps: 9_000,
      retainedFractionBps: 1_000,
      integerRemainderPolicy: 'payout',
      destinationMode: 'primary',
      sourceKind: input.sourceKind,
    },
  });
  recordGhostWalletPerformance({
    stage: 'settlement',
    chain: input.chain,
    routeKey: `${input.transactionHash.toLowerCase()}:${input.logIndex}:${input.asset.toLowerCase()}`,
    sourceKind: input.sourceKind,
    success: true,
    realizedProfitBaseUnits: input.amount,
  });
  return true;
}

async function recordVerifiedBorrower(input: {
  chain: string;
  borrower: string;
  asset: string;
  transactionHash: string;
}): Promise<void> {
  await upsertGhostWalletVenue({
    venueId: `erc3156-borrower:${input.chain}:${input.borrower.toLowerCase()}`,
    chain: input.chain,
    protocol: 'erc3156',
    role: 'borrower',
    address: input.borrower,
    asset: input.asset,
    adapter: 'erc3156_flash_borrower',
    discoveredFrom: 'successful_broker_settlement',
    verified: true,
    capabilities: { sameTransactionRepaymentObserved: true, atomicCallback: true },
    metadata: { lastSuccessfulSettlementTx: input.transactionHash },
  });
}

export async function ingestGhostWalletSettlementLog(chainValue: string, log: providers.Log): Promise<number> {
  const chain = chainValue.trim().toLowerCase();
  const primary = resolvePrimaryProfitPayoutAddress();
  if (!primary) return 0;
  let parsed: ethers.utils.LogDescription;
  try { parsed = EVENT_INTERFACE.parseLog(log); } catch { return 0; }
  const args = parsed.args;
  let enqueued = 0;

  if (parsed.name === 'AtomicCreditSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: addr(args.asset), amount: amount(args.realizedProfit), sourceKind: 'atomic_credit' })) enqueued += 1;
  } else if (parsed.name === 'AtomicLiabilityCycleSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: addr(args.profitAsset), amount: amount(args.realizedProfit), sourceKind: 'atomic_liability_cycle' })) enqueued += 1;
  } else if (parsed.name === 'MatchedIntentPairSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    const tokenA = addr(args.tokenA);
    const tokenB = addr(args.tokenB);
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: tokenB, amount: amount(args.feeA), sourceKind: 'matched_intent_fee_a' })) enqueued += 1;
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: tokenA, amount: amount(args.feeB), sourceKind: 'matched_intent_fee_b' })) enqueued += 1;
  } else if (parsed.name === 'VaultCreditSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    const asset = addr(args.asset);
    const vault = addr(args.vault);
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset, amount: amount(args.realizedProfit), sourceKind: 'vault_atomic_credit' })) enqueued += 1;
    await upsertGhostWalletVenue({
      venueId: `ghost-vault:${chain}:${vault.toLowerCase()}`, chain, protocol: 'ghost_wallet_erc4626', role: 'lender',
      address: vault, asset, adapter: 'ghost_wallet_capital_vault', discoveredFrom: 'verified_settlement_event', verified: true,
      capabilities: { sameTransactionSettlement: true, repaymentFailureReverts: true },
      metadata: { lastSettlementTx: log.transactionHash },
    });
  } else if (parsed.name === 'BrokeredAtomicCreditSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    const borrower = addr(args.borrower);
    const vault = addr(args.vault);
    const asset = addr(args.asset);
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset, amount: amount(args.realizedSpread), sourceKind: 'brokered_atomic_credit' })) enqueued += 1;
    await Promise.all([
      recordVerifiedBorrower({ chain, borrower, asset, transactionHash: log.transactionHash }),
      upsertGhostWalletVenue({
        venueId: `ghost-vault:${chain}:${vault.toLowerCase()}`, chain, protocol: 'ghost_wallet_erc4626', role: 'lender',
        address: vault, asset, adapter: 'ghost_wallet_capital_vault', discoveredFrom: 'successful_broker_settlement', verified: true,
        capabilities: { sameTransactionSettlement: true, repaymentFailureReverts: true },
        metadata: { lastSuccessfulSettlementTx: log.transactionHash },
      }),
    ]);
  } else if (parsed.name === 'ExternalCreditBrokered') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    const lender = addr(args.lender);
    const borrower = addr(args.borrower);
    const asset = addr(args.token);
    const protocol = upstreamProtocol(Number(args.upstreamKind));
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset, amount: amount(args.realizedSpread), sourceKind: `external_credit:${protocol}` })) enqueued += 1;
    await Promise.all([
      recordVerifiedBorrower({ chain, borrower, asset, transactionHash: log.transactionHash }),
      upsertGhostWalletVenue({
        venueId: `external-lender:${chain}:${protocol}:${lender.toLowerCase()}:${asset.toLowerCase()}`,
        chain, protocol, role: 'lender', address: lender, asset,
        adapter: `caller_funded_${protocol}`, discoveredFrom: 'successful_external_credit_settlement', verified: true,
        capabilities: {
          sameTransactionSettlementObserved: true,
          repaymentFailureReverts: true,
          operatorMonetaryInputRequired: false,
          upstreamFeeBaseUnits: amount(args.upstreamFee).toString(),
          borrowerFeeBaseUnits: amount(args.borrowerFee).toString(),
        },
        metadata: { lastSuccessfulSettlementTx: log.transactionHash },
      }),
    ]);
  }

  if (enqueued > 0) {
    await recordGhostWalletRuntimeState({
      chain, reconciledBlock: log.blockNumber, notification: true, workerActivity: true,
      metadata: {
        lastSettlementTransactionHash: log.transactionHash,
        settlementEvent: parsed.name,
        realizedProfitAllocation: '90_percent_payout_10_percent_retained_integer_remainder_to_payout',
      },
    });
    ghostWalletWorkSignal.emitWake('local_work_enqueued');
  }
  return enqueued;
}

export async function ingestGhostWalletSettlementReceipt(chain: string, receipt: providers.TransactionReceipt): Promise<number> {
  let total = 0;
  for (const log of receipt.logs) total += await ingestGhostWalletSettlementLog(chain, log);
  return total;
}

export const GHOST_WALLET_SETTLEMENT_EVENT_TOPICS = Object.values(EVENT_INTERFACE.events)
  .map(event => EVENT_INTERFACE.getEventTopic(event));
