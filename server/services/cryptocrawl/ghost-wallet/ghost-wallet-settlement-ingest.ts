import { ethers, providers } from 'ethers';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { recordGhostWalletPerformance } from './ghost-wallet-performance-intelligence.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
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
const ENTRY_POINT_INTERFACE = new ethers.utils.Interface([
  'event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)',
]);
const ENTRY_POINT_V08 = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const PROFIT_SPLIT_DENOMINATOR = 10n;
const RETAINED_SPLIT_NUMERATOR = 1n;
const RECEIPT_CONTEXT_CACHE_MS = 60_000;

interface SponsoredCostContext {
  eventLogIndex: number;
  userOperationHash: string;
  actualGasCostWei: bigint;
  billedGasCostWei: bigint;
  adjustments: Map<string, bigint>;
  allocatedByProfitKey: Map<string, bigint>;
}

interface UserOperationBoundary {
  eventLogIndex: number;
  sponsored: SponsoredCostContext | null;
}

interface ReceiptSettlementContext {
  receipt: providers.TransactionReceipt;
  boundaries: UserOperationBoundary[];
}

interface ProfitEntry {
  logIndex: number;
  asset: string;
  gross: bigint;
}

const receiptContextCache = new Map<string, { expiresAt: number; promise: Promise<ReceiptSettlementContext> }>();

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

function divUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('GHOST_WALLET_SETTLEMENT_COST_DIVISOR_INVALID');
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function positiveBigInt(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = BigInt(raw);
  return parsed > 0n ? parsed : null;
}

function surchargeBps(value: unknown): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 5_000) return parsed;
  const configured = Number(process.env.GHOST_WALLET_PIMLICO_SURCHARGE_BPS || '1000');
  return Number.isInteger(configured) && configured >= 0 && configured <= 5_000 ? configured : 1_000;
}

function billedGasCostWei(actualGasCostWei: bigint, bps: number): bigint {
  return divUp(actualGasCostWei * BigInt(10_000 + bps), 10_000n);
}

function mergeAdjustment(target: Map<string, bigint>, asset: string, value: bigint): void {
  if (value <= 0n) return;
  const key = asset.toLowerCase();
  target.set(key, (target.get(key) || 0n) + value);
}

function sponsoredMode(work: any): string {
  const payload = work?.payload && typeof work.payload === 'object' ? work.payload : {};
  if (payload.mode) return String(payload.mode);
  return work?.kind === 'matched_intent_settlement' ? 'matched_intent' : '';
}

function sponsoredCostAdjustments(work: any, billedActualWei: bigint): Map<string, bigint> {
  const payload = work?.payload && typeof work.payload === 'object' ? work.payload : {};
  const result = work?.result && typeof work.result === 'object' ? work.result : {};
  const estimatedUnits = positiveBigInt(result.billableGasUnitsWithSurcharge);
  const estimatedFee = positiveBigInt(result.billingFeePerGasWei);
  if (!estimatedUnits || !estimatedFee) return new Map();
  const estimatedBilledWei = estimatedUnits * estimatedFee;
  if (estimatedBilledWei <= 0n) return new Map();

  const adjustments = new Map<string, bigint>();
  const mode = sponsoredMode(work);
  if (mode === 'broker_execution') {
    const asset = String(payload.asset || '').trim();
    const estimatedAssetCost = positiveBigInt(result.finalGasCostAssetBaseUnits);
    if (ethers.utils.isAddress(asset) && estimatedAssetCost) {
      mergeAdjustment(adjustments, asset, divUp(estimatedAssetCost * billedActualWei, estimatedBilledWei));
    }
    return adjustments;
  }

  if (mode !== 'matched_intent') return adjustments;
  const estimatedGasUsdScaled = positiveBigInt(result.matchedIntentGasCostUsdScaled);
  const rawAssets = Array.isArray(result.matchedIntentProfitAssets) ? result.matchedIntentProfitAssets : [];
  const assets = rawAssets.flatMap((entry: any) => {
    const asset = String(entry?.asset || '').trim();
    const tokenAmount = positiveBigInt(entry?.amountBaseUnits);
    const valueUsdScaled = positiveBigInt(entry?.valueUsdScaled);
    return ethers.utils.isAddress(asset) && tokenAmount && valueUsdScaled
      ? [{ asset: ethers.utils.getAddress(asset), tokenAmount, valueUsdScaled }]
      : [];
  });
  if (!estimatedGasUsdScaled || assets.length === 0) return adjustments;

  const actualGasUsdScaled = divUp(estimatedGasUsdScaled * billedActualWei, estimatedBilledWei);
  const totalValueUsdScaled = assets.reduce((sum, entry) => sum + entry.valueUsdScaled, 0n);
  if (totalValueUsdScaled <= 0n) return adjustments;
  let allocatedUsd = 0n;
  assets.forEach((entry, index) => {
    const shareUsd = index === assets.length - 1
      ? actualGasUsdScaled - allocatedUsd
      : (actualGasUsdScaled * entry.valueUsdScaled) / totalValueUsdScaled;
    allocatedUsd += shareUsd;
    if (shareUsd <= 0n) return;
    const tokenCost = divUp(entry.tokenAmount * shareUsd, entry.valueUsdScaled);
    mergeAdjustment(adjustments, entry.asset, tokenCost);
  });
  return adjustments;
}

async function loadSponsoredContext(userOperationHash: string, actualGasCostWei: bigint, eventLogIndex: number): Promise<SponsoredCostContext | null> {
  const result = await pool.query(
    `SELECT work_id,kind,payload,result
     FROM private.cryptocrawler_ghost_wallet_work
     WHERE lower(transaction_hash)=lower($1)
       AND result->>'submissionKind'='pimlico_user_operation'
     ORDER BY submitted_at DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [userOperationHash],
  );
  const work = result.rows[0];
  if (!work) return null;
  const rowResult = work.result && typeof work.result === 'object' ? work.result : {};
  const bps = surchargeBps(rowResult.pimlicoSurchargeBps);
  const billed = billedGasCostWei(actualGasCostWei, bps);
  const adjustments = sponsoredCostAdjustments(work, billed);
  const mode = sponsoredMode(work);
  if ((mode === 'broker_execution' || mode === 'matched_intent') && billed > 0n && adjustments.size === 0) {
    throw new Error(`GHOST_WALLET_SPONSORED_COST_ALLOCATION_UNAVAILABLE:${mode}:${userOperationHash}`);
  }
  await pool.query(
    `UPDATE private.cryptocrawler_ghost_wallet_work
     SET result=result || $2::jsonb, updated_at=now()
     WHERE work_id=$1`,
    [work.work_id, JSON.stringify({
      entryPointActualGasCostWei: actualGasCostWei.toString(),
      pimlicoActualBilledGasCostWei: billed.toString(),
      pimlicoRealizedCostAuthority: 'entrypoint_user_operation_event_actual_gas_cost_plus_pimlico_surcharge',
    })],
  );
  return {
    eventLogIndex,
    userOperationHash,
    actualGasCostWei,
    billedGasCostWei: billed,
    adjustments,
    allocatedByProfitKey: new Map(),
  };
}

function settlementProfitEntries(log: providers.Log): ProfitEntry[] {
  const primary = resolvePrimaryProfitPayoutAddress();
  if (!primary) return [];
  let parsed: ethers.utils.LogDescription;
  try { parsed = EVENT_INTERFACE.parseLog(log); } catch { return []; }
  const args = parsed.args;
  const recipient = (() => {
    try { return addr(args.profitRecipient); } catch { return ''; }
  })();
  if (!recipient || recipient.toLowerCase() !== primary.toLowerCase()) return [];
  if (parsed.name === 'AtomicCreditSettled') return [{ logIndex: log.logIndex, asset: addr(args.asset), gross: amount(args.realizedProfit) }];
  if (parsed.name === 'AtomicLiabilityCycleSettled') return [{ logIndex: log.logIndex, asset: addr(args.profitAsset), gross: amount(args.realizedProfit) }];
  if (parsed.name === 'MatchedIntentPairSettled') return [
    { logIndex: log.logIndex, asset: addr(args.tokenB), gross: amount(args.feeA) },
    { logIndex: log.logIndex, asset: addr(args.tokenA), gross: amount(args.feeB) },
  ];
  if (parsed.name === 'VaultCreditSettled') return [{ logIndex: log.logIndex, asset: addr(args.asset), gross: amount(args.realizedProfit) }];
  if (parsed.name === 'BrokeredAtomicCreditSettled') return [{ logIndex: log.logIndex, asset: addr(args.asset), gross: amount(args.realizedSpread) }];
  if (parsed.name === 'ExternalCreditBrokered') return [{ logIndex: log.logIndex, asset: addr(args.token), gross: amount(args.realizedSpread) }];
  return [];
}

function profitCostKey(logIndex: number, asset: string): string {
  return `${logIndex}:${asset.toLowerCase()}`;
}

function allocateSponsoredCosts(receipt: providers.TransactionReceipt, boundaries: UserOperationBoundary[]): void {
  let previousBoundary = -1;
  for (const boundary of boundaries) {
    const sponsored = boundary.sponsored;
    if (sponsored) {
      const remaining = new Map(sponsored.adjustments);
      const entries = receipt.logs
        .filter(log => log.logIndex > previousBoundary && log.logIndex < boundary.eventLogIndex)
        .flatMap(settlementProfitEntries)
        .sort((left, right) => left.logIndex - right.logIndex);
      for (const entry of entries) {
        const assetKey = entry.asset.toLowerCase();
        const available = remaining.get(assetKey) || 0n;
        if (available <= 0n || entry.gross <= 0n) continue;
        const allocated = available > entry.gross ? entry.gross : available;
        sponsored.allocatedByProfitKey.set(profitCostKey(entry.logIndex, entry.asset), allocated);
        const next = available - allocated;
        if (next > 0n) remaining.set(assetKey, next);
        else remaining.delete(assetKey);
      }
    }
    previousBoundary = boundary.eventLogIndex;
  }
}

async function buildReceiptSettlementContext(receipt: providers.TransactionReceipt): Promise<ReceiptSettlementContext> {
  const userOperationEvents = receipt.logs.flatMap(log => {
    if (log.address.toLowerCase() !== ENTRY_POINT_V08.toLowerCase()) return [];
    try {
      const parsed = ENTRY_POINT_INTERFACE.parseLog(log);
      if (parsed.name !== 'UserOperationEvent') return [];
      return [{
        eventLogIndex: log.logIndex,
        userOperationHash: String(parsed.args.userOpHash),
        actualGasCostWei: amount(parsed.args.actualGasCost),
      }];
    } catch {
      return [];
    }
  }).sort((left, right) => left.eventLogIndex - right.eventLogIndex);
  const contexts = await Promise.all(userOperationEvents.map(event => loadSponsoredContext(
    event.userOperationHash,
    event.actualGasCostWei,
    event.eventLogIndex,
  )));
  const boundaries: UserOperationBoundary[] = userOperationEvents.map((event, index) => ({
    eventLogIndex: event.eventLogIndex,
    sponsored: contexts[index],
  }));
  allocateSponsoredCosts(receipt, boundaries);
  return { receipt, boundaries };
}

function contextForLog(context: ReceiptSettlementContext | null, log: providers.Log): SponsoredCostContext | null {
  if (!context) return null;
  const boundary = context.boundaries.find(entry => entry.eventLogIndex > log.logIndex);
  return boundary?.sponsored || null;
}

async function settlementContextForLog(chain: string, log: providers.Log): Promise<ReceiptSettlementContext | null> {
  const key = `${chain}:${log.transactionHash.toLowerCase()}`;
  const cached = receiptContextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = (async () => {
    const provider = await ghostWalletProviderMesh.getProvider(chain as GhostWalletChain);
    if (!provider) throw new Error(`GHOST_WALLET_SETTLEMENT_RECEIPT_PROVIDER_UNAVAILABLE:${chain}`);
    const receipt = await provider.getTransactionReceipt(log.transactionHash);
    if (!receipt) throw new Error(`GHOST_WALLET_SETTLEMENT_RECEIPT_UNAVAILABLE:${log.transactionHash}`);
    return buildReceiptSettlementContext(receipt);
  })();
  receiptContextCache.set(key, { expiresAt: Date.now() + RECEIPT_CONTEXT_CACHE_MS, promise });
  try {
    return await promise;
  } catch (error) {
    receiptContextCache.delete(key);
    throw error;
  }
}

async function enqueueProfit(input: {
  chain: string;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  asset: string;
  amount: bigint;
  sourceKind: string;
  sponsoredContext?: SponsoredCostContext | null;
}): Promise<boolean> {
  if (input.amount <= 0n) return false;
  const sponsoredGasCost = input.sponsoredContext
    ? input.sponsoredContext.allocatedByProfitKey.get(profitCostKey(input.logIndex, input.asset)) || 0n
    : 0n;
  const netRealized = input.amount - sponsoredGasCost;
  const allocation = splitRealizedProfit(netRealized);
  if (allocation.payout <= 0n) {
    recordGhostWalletPerformance({
      stage: 'settlement',
      chain: input.chain,
      routeKey: `${input.transactionHash.toLowerCase()}:${input.logIndex}:${input.asset.toLowerCase()}`,
      sourceKind: input.sourceKind,
      success: false,
      realizedProfitBaseUnits: netRealized,
      errorType: sponsoredGasCost > 0n ? 'realized_sponsored_cost_consumed_profit' : 'realized_profit_non_positive',
    });
    return false;
  }
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
      grossRealizedProfitBaseUnits: input.amount.toString(),
      sponsoredGasCostBaseUnits: sponsoredGasCost.toString(),
      netRealizedProfitBaseUnits: netRealized.toString(),
      realizedProfitBaseUnits: netRealized.toString(),
      payoutAmountBaseUnits: allocation.payout.toString(),
      retainedAmountBaseUnits: allocation.retained.toString(),
      payoutFractionBps: 9_000,
      retainedFractionBps: 1_000,
      integerRemainderPolicy: 'payout',
      destinationMode: 'primary',
      sourceKind: input.sourceKind,
      ...(input.sponsoredContext ? {
        sponsoredUserOperationHash: input.sponsoredContext.userOperationHash,
        entryPointActualGasCostWei: input.sponsoredContext.actualGasCostWei.toString(),
        pimlicoActualBilledGasCostWei: input.sponsoredContext.billedGasCostWei.toString(),
        allInProfitSplitAuthority: 'net_realized_after_pimlico_sponsored_gas',
      } : {}),
    },
  });
  recordGhostWalletPerformance({
    stage: 'settlement',
    chain: input.chain,
    routeKey: `${input.transactionHash.toLowerCase()}:${input.logIndex}:${input.asset.toLowerCase()}`,
    sourceKind: input.sourceKind,
    success: true,
    realizedProfitBaseUnits: netRealized,
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

async function ingestSettlementLogWithContext(
  chainValue: string,
  log: providers.Log,
  receiptContext: ReceiptSettlementContext | null,
): Promise<number> {
  const chain = chainValue.trim().toLowerCase();
  const primary = resolvePrimaryProfitPayoutAddress();
  if (!primary) return 0;
  let parsed: ethers.utils.LogDescription;
  try { parsed = EVENT_INTERFACE.parseLog(log); } catch { return 0; }
  const sponsoredContext = contextForLog(receiptContext, log);
  const args = parsed.args;
  let enqueued = 0;

  if (parsed.name === 'AtomicCreditSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: addr(args.asset), amount: amount(args.realizedProfit), sourceKind: 'atomic_credit', sponsoredContext })) enqueued += 1;
  } else if (parsed.name === 'AtomicLiabilityCycleSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: addr(args.profitAsset), amount: amount(args.realizedProfit), sourceKind: 'atomic_liability_cycle', sponsoredContext })) enqueued += 1;
  } else if (parsed.name === 'MatchedIntentPairSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    const tokenA = addr(args.tokenA);
    const tokenB = addr(args.tokenB);
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: tokenB, amount: amount(args.feeA), sourceKind: 'matched_intent_fee_a', sponsoredContext })) enqueued += 1;
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset: tokenA, amount: amount(args.feeB), sourceKind: 'matched_intent_fee_b', sponsoredContext })) enqueued += 1;
  } else if (parsed.name === 'VaultCreditSettled') {
    if (addr(args.profitRecipient).toLowerCase() !== primary.toLowerCase()) return 0;
    const asset = addr(args.asset);
    const vault = addr(args.vault);
    if (await enqueueProfit({ chain, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex,
      asset, amount: amount(args.realizedProfit), sourceKind: 'vault_atomic_credit', sponsoredContext })) enqueued += 1;
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
      asset, amount: amount(args.realizedSpread), sourceKind: 'brokered_atomic_credit', sponsoredContext })) enqueued += 1;
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
      asset, amount: amount(args.realizedSpread), sourceKind: `external_credit:${protocol}`, sponsoredContext })) enqueued += 1;
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
        realizedProfitAllocation: sponsoredContext
          ? 'pimlico_cost_first_then_90_percent_payout_10_percent_retained'
          : '90_percent_payout_10_percent_retained_integer_remainder_to_payout',
        sponsoredUserOperationHash: sponsoredContext?.userOperationHash || null,
      },
    });
    ghostWalletWorkSignal.emitWake('local_work_enqueued');
  }
  return enqueued;
}

export async function ingestGhostWalletSettlementLog(chainValue: string, log: providers.Log): Promise<number> {
  const context = await settlementContextForLog(chainValue.trim().toLowerCase(), log);
  return ingestSettlementLogWithContext(chainValue, log, context);
}

export async function ingestGhostWalletSettlementReceipt(chain: string, receipt: providers.TransactionReceipt): Promise<number> {
  const context = await buildReceiptSettlementContext(receipt);
  let total = 0;
  for (const log of receipt.logs) total += await ingestSettlementLogWithContext(chain, log, context);
  return total;
}

export const GHOST_WALLET_SETTLEMENT_EVENT_TOPICS = Object.values(EVENT_INTERFACE.events)
  .map(event => EVENT_INTERFACE.getEventTopic(event));

export const GHOST_WALLET_SETTLEMENT_ACCOUNTING_POLICY = {
  grossProfitSplitAllowedForSponsoredExecution: false,
  pimlicoActualCostSource: 'entrypoint_user_operation_event',
  pimlicoMainnetSurchargeIncluded: true,
  sponsoredGasDeductedBeforeProfitSplit: true,
  sponsoredCostProvenanceRequiredBeforePayout: true,
  userOperationBoundariesPreserved: true,
  deterministicRetrySafeCostAllocation: true,
  payoutFractionBps: 9_000,
  retainedFractionBps: 1_000,
  allInNetSettlementProvenance: true,
  receiptContextCacheMs: RECEIPT_CONTEXT_CACHE_MS,
  executionHotPathRpcAdded: false,
} as const;
