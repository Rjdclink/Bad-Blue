import logger from '../../../logger.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getVenueCapability, isVenueLiveExecutable, type CryptoCrawlerCexVenue } from '../discovery/venue-capability-registry.js';
import { centralizedExchangeExecutor, type ArbitrageExecutionResult } from '../execution/centralized-exchange-executor.js';
import { cexInventoryLedger, type InventorySnapshot, type InventoryVenue } from '../execution/cex-inventory-ledger.js';
import {
  createProductionCexSettlementAdapters,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
} from '../execution/cex-settlement.js';

const installed = new WeakSet<object>();

type BalanceCapableAdapter = CexSettlementAdapter & {
  getBalances: () => Promise<Record<string, string>>;
};

type ReoptimizationDecision =
  | { kind: 'execute'; plan: VerifiedArbitragePlan; resized: boolean }
  | { kind: 'reject'; reason: string };

function reject(reason: string): ArbitrageExecutionResult {
  return {
    success: false,
    status: 'rejected',
    settlementConfirmed: false,
    error: reason,
  };
}

function splitSpotSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function snapshot(venue: InventoryVenue, asset: string): InventorySnapshot | null {
  return cexInventoryLedger.getSnapshots().find(item =>
    item.venue === venue && item.asset.toUpperCase() === asset.toUpperCase(),
  ) ?? null;
}

function spendable(value: InventorySnapshot | null): number {
  if (!value) return 0;
  return Math.max(0,
    value.available - value.reserved - value.pendingOrder - value.pendingTransfer - value.minimumReserve,
  );
}

function maxFeeEvidenceAgeMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_EXECUTION_FEE_MAX_AGE_MS || 5 * 60_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(30 * 60_000, Math.trunc(parsed))) : 5 * 60_000;
}

function feeFreshnessRejection(plan: VerifiedArbitragePlan): string | null {
  if (!plan.feeEvidence?.buy || !plan.feeEvidence?.sell) return 'REJECT_FEE_EVIDENCE: complete buy/sell fee evidence is required';
  const now = Date.now();
  for (const [side, evidence] of [['buy', plan.feeEvidence.buy], ['sell', plan.feeEvidence.sell]] as const) {
    if (!Number.isFinite(evidence.observedAt) || evidence.observedAt <= 0) return `REJECT_FEE_EVIDENCE: ${side} fee timestamp is invalid`;
    if (now - evidence.observedAt > maxFeeEvidenceAgeMs()) return `REJECT_FEE_EVIDENCE_STALE: ${side} fee evidence exceeds bounded execution age`;
    if (!Number.isFinite(Number(evidence.takerFeeBps)) || Number(evidence.takerFeeBps) < 0) return `REJECT_FEE_EVIDENCE: ${side} taker fee is unavailable`;
  }
  return null;
}

function buyFeeRate(plan: VerifiedArbitragePlan): number | null {
  const feeBps = Number(plan.feeEvidence?.buy.takerFeeBps);
  if (Number.isFinite(feeBps) && feeBps >= 0) return feeBps / 10_000;
  if (plan.notionalUsd > 0 && Number.isFinite(plan.costs.buyFeeUsd) && plan.costs.buyFeeUsd >= 0) {
    return plan.costs.buyFeeUsd / plan.notionalUsd;
  }
  return null;
}

function inventoryCapacity(plan: VerifiedArbitragePlan): {
  pair: { base: string; quote: string };
  buyQuoteSpendable: number;
  sellBaseSpendable: number;
  fullPlanFundable: boolean;
  maxFundableNotionalUsd: number;
} | null {
  const pair = splitSpotSymbol(plan.symbol);
  if (!pair) return null;
  const buyVenue = plan.buyVenue as InventoryVenue;
  const sellVenue = plan.sellVenue as InventoryVenue;
  const buyQuoteSpendable = spendable(snapshot(buyVenue, pair.quote));
  const sellBaseSpendable = spendable(snapshot(sellVenue, pair.base));
  const buyPrice = plan.buyLimitPrice ?? plan.buyAsk;
  const feeRate = buyFeeRate(plan);
  if (!(buyPrice > 0) || feeRate === null || feeRate < 0) return null;

  const fullRequiredQuote = plan.baseQty * buyPrice * (1 + feeRate);
  const fullPlanFundable = buyQuoteSpendable + 1e-12 >= fullRequiredQuote && sellBaseSpendable + 1e-12 >= plan.baseQty;
  const buyLimitedNotional = buyQuoteSpendable / Math.max(1, 1 + feeRate);
  const sellLimitedNotional = sellBaseSpendable * buyPrice;
  const requestBound = Math.max(0, plan.requestedNotionalUsd || plan.notionalUsd);
  const maxFundableNotionalUsd = Math.max(0, Math.min(requestBound, buyLimitedNotional, sellLimitedNotional));
  return { pair, buyQuoteSpendable, sellBaseSpendable, fullPlanFundable, maxFundableNotionalUsd };
}

function activeExecutionCapability(plan: VerifiedArbitragePlan): string | null {
  for (const rawVenue of [plan.buyVenue, plan.sellVenue]) {
    const venue = rawVenue as CryptoCrawlerCexVenue;
    const capability = getVenueCapability(venue);
    if (!capability || !isVenueLiveExecutable(venue) || !capability.executableQuotes || !capability.authenticatedFeeEvidence) {
      return `REJECT_CEX_CAPABILITY: ${rawVenue} is not an active measured/authenticated live execution venue`;
    }
  }
  return null;
}

async function reconcilePairBalances(plan: VerifiedArbitragePlan): Promise<boolean> {
  const adapters = createProductionCexSettlementAdapters();
  const buyVenue = plan.buyVenue as ExecutableCexVenue;
  const sellVenue = plan.sellVenue as ExecutableCexVenue;
  const buyAdapter = adapters[buyVenue] as BalanceCapableAdapter | undefined;
  const sellAdapter = adapters[sellVenue] as BalanceCapableAdapter | undefined;
  if (!buyAdapter?.getBalances || !sellAdapter?.getBalances) return false;
  try {
    const [buyBalances, sellBalances] = await Promise.all([
      buyAdapter.getBalances(),
      sellAdapter.getBalances(),
    ]);
    await Promise.all([
      cexInventoryLedger.reconcile(buyVenue as InventoryVenue, buyBalances),
      cexInventoryLedger.reconcile(sellVenue as InventoryVenue, sellBalances),
    ]);
    return true;
  } catch (error) {
    logger.warn('[InventoryConstrainedCex] Authenticated balance refresh failed; execution rejected before expensive downstream admission', {
      component: 'InventoryConstrainedCexExecutionWiring',
      symbol: plan.symbol,
      buyVenue: plan.buyVenue,
      sellVenue: plan.sellVenue,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function reoptimizeForInventory(plan: VerifiedArbitragePlan): Promise<ReoptimizationDecision> {
  const capabilityRejection = activeExecutionCapability(plan);
  if (capabilityRejection) return { kind: 'reject', reason: capabilityRejection };
  const feeRejection = feeFreshnessRejection(plan);
  if (feeRejection) return { kind: 'reject', reason: feeRejection };
  if (!Number.isFinite(plan.netProfitUsd) || !(plan.netProfitUsd > 0)) {
    return { kind: 'reject', reason: 'REJECT_NEGATIVE_NET_EDGE: strict positive measured all-in economics required before inventory work' };
  }
  if (!await reconcilePairBalances(plan)) {
    return { kind: 'reject', reason: 'REJECT_BALANCE_UNVERIFIED: authenticated spendable inventory could not be reconciled' };
  }

  const capacity = inventoryCapacity(plan);
  if (!capacity) return { kind: 'reject', reason: 'REJECT_INVENTORY_EVIDENCE: inventory capacity could not be measured for this spot pair' };
  if (capacity.fullPlanFundable) return { kind: 'execute', plan, resized: false };
  if (!(capacity.maxFundableNotionalUsd > 0) || capacity.buyQuoteSpendable <= 0 || capacity.sellBaseSpendable <= 0) {
    return { kind: 'reject', reason: 'REJECT_BALANCE_INSUFFICIENT: no positive two-sided authenticated inventory capacity' };
  }

  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const refreshed = await arbitrageVerifier.evaluateOnce({
    symbol: plan.symbol,
    notionalUsd: capacity.maxFundableNotionalUsd,
    maxQuoteAgeMs,
    minNetProfitUsd: 0,
  }).catch(error => {
    logger.warn('[InventoryConstrainedCex] Fresh inventory-bounded economics evaluation failed closed', {
      component: 'InventoryConstrainedCexExecutionWiring',
      symbol: plan.symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!refreshed) return { kind: 'reject', reason: 'REJECT_RESIZE_REQUOTE: no fresh verified plan for authenticated inventory capacity' };
  if (feeFreshnessRejection(refreshed)) return { kind: 'reject', reason: 'REJECT_RESIZED_FEE_EVIDENCE: fresh-sized plan lacks current fee evidence' };
  if (refreshed.buyVenue !== plan.buyVenue || refreshed.sellVenue !== plan.sellVenue) {
    logger.info('[InventoryConstrainedCex] Fresh best venue pair changed; preserving opportunity identity and returning to discovery', {
      component: 'InventoryConstrainedCexExecutionWiring',
      symbol: plan.symbol,
      originalPair: `${plan.buyVenue}->${plan.sellVenue}`,
      freshPair: `${refreshed.buyVenue}->${refreshed.sellVenue}`,
      requestedNotionalUsd: plan.requestedNotionalUsd,
      maxFundableNotionalUsd: capacity.maxFundableNotionalUsd,
    });
    return { kind: 'reject', reason: 'REJECT_VENUE_DRIFT: fresh inventory-bounded optimization changed venue pair' };
  }
  if (!Number.isFinite(refreshed.netProfitUsd) || refreshed.netProfitUsd <= 0) {
    return { kind: 'reject', reason: 'REJECT_RESIZED_NEGATIVE_NET: resized fresh plan is not strictly profitable after measured costs' };
  }

  const refreshedCapacity = inventoryCapacity(refreshed);
  if (!refreshedCapacity?.fullPlanFundable) {
    return { kind: 'reject', reason: 'REJECT_RESIZED_INVENTORY_DRIFT: refreshed size exceeds authenticated spendable capacity' };
  }

  logger.info('[InventoryConstrainedCex] Profitable CEX plan resized to authenticated spendable inventory', {
    component: 'InventoryConstrainedCexExecutionWiring',
    symbol: plan.symbol,
    venuePair: `${plan.buyVenue}->${plan.sellVenue}`,
    originalNotionalUsd: plan.notionalUsd,
    resizedNotionalUsd: refreshed.notionalUsd,
    maxFundableNotionalUsd: capacity.maxFundableNotionalUsd,
    originalNetProfitUsd: plan.netProfitUsd,
    resizedNetProfitUsd: refreshed.netProfitUsd,
    buyQuoteSpendable: capacity.buyQuoteSpendable,
    sellBaseSpendable: capacity.sellBaseSpendable,
    economicsAuthority: 'fresh_order_books_plus_bounded_current_fee_evidence',
    inventoryAuthority: 'authenticated_spendable_balance_after_reserves',
    bpsExecutionFloor: null,
    executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
    syntheticScaling: false,
  });
  return { kind: 'execute', plan: refreshed, resized: true };
}

export function ensureInventoryConstrainedCexExecutionWiring(): void {
  const target = centralizedExchangeExecutor as unknown as {
    execute: (plan: VerifiedArbitragePlan) => Promise<ArbitrageExecutionResult>;
  };
  if (installed.has(target)) return;
  installed.add(target);

  const originalExecute = target.execute.bind(target);
  target.execute = async (plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> => {
    const decision = await reoptimizeForInventory(plan);
    if (decision.kind === 'reject') {
      logger.info('[InventoryConstrainedCex] Execution rejected before downstream admission', {
        component: 'InventoryConstrainedCexExecutionWiring',
        symbol: plan.symbol,
        venuePair: `${plan.buyVenue}->${plan.sellVenue}`,
        reason: decision.reason,
        resourceWorkAvoided: true,
      });
      return reject(decision.reason);
    }
    return originalExecute(decision.plan);
  };

  logger.info('[InventoryConstrainedCex] Inventory-aware CEX re-optimization installed', {
    component: 'InventoryConstrainedCexExecutionWiring',
    authenticatedBalances: true,
    boundedFeeEvidenceAgeMs: maxFeeEvidenceAgeMs(),
    partialInventoryCanResize: true,
    zeroInventoryBypass: false,
    freshEconomicsRequiredAfterResize: true,
    sameVenuePairRequired: true,
    inactiveVenueExecutionRejectedUpstream: true,
    unverifiedBalanceExecutionRejectedUpstream: true,
    duplicateDownstreamAdmissionAvoidedOnKnownResourceFailure: true,
    bpsExecutionFloor: null,
    executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
    terminalSettlementAuthorityUnchanged: true,
  });
}
