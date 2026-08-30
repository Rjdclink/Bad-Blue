import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import logger from '../../../logger.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import { cexInventoryLedger, type InventoryRequirement, type InventoryVenue } from './cex-inventory-ledger.js';
import { assertFreshCexProductConstraints } from './cex-submit-time-product-guard.js';
import { parallelMonteCarloPool } from './adapters/parallel-monte-carlo-pool.js';
import {
  createProductionCexSettlementAdapters,
  executeCexPlan,
  type CexExecutorOptions,
  type CexExecutionResult,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
} from './cex-settlement.js';

export type ExchangeOrderReceipt = NonNullable<CexExecutionResult['buyOrder']>;
export type ArbitrageExecutionResult = CexExecutionResult;

type BalanceCapableAdapter = CexSettlementAdapter & {
  getBalances: () => Promise<Record<string, string>>;
};

const SUPPORTED_CEX_VENUES = new Set<ExecutableCexVenue>(['coinbase', 'kraken', 'okx']);

function rejectPlan(error: string): ArbitrageExecutionResult {
  return {
    success: false,
    status: 'rejected',
    settlementConfirmed: false,
    error,
  };
}

function splitSpotSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function measuredLiquidityCoverage(plan: VerifiedArbitragePlan): number {
  if (plan.liquidity.status !== 'measured' ||
      plan.liquidity.buyAvailableBaseQty === null ||
      plan.liquidity.sellAvailableBaseQty === null ||
      !(plan.baseQty > 0)) return 0;
  return Math.max(0, Math.min(1,
    Math.min(plan.liquidity.buyAvailableBaseQty, plan.liquidity.sellAvailableBaseQty) / plan.baseQty,
  ));
}

function opportunityIdentity(plan: VerifiedArbitragePlan): string {
  return `cex-inventory:${plan.buyVenue}:${plan.sellVenue}:${plan.symbol}:${plan.buyAsk}:${plan.sellBid}:${plan.baseQty}`;
}

function spendableSnapshot(venue: InventoryVenue, asset: string) {
  return cexInventoryLedger.getSnapshots().find(snapshot =>
    snapshot.venue === venue && snapshot.asset.toUpperCase() === asset.toUpperCase(),
  );
}

function authenticatedBalanceFreshnessMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_BALANCE_CACHE_MS || 5_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(15_000, Math.trunc(parsed))) : 5_000;
}

function hasFreshAuthenticatedPairInventory(
  buyVenue: InventoryVenue,
  sellVenue: InventoryVenue,
  pair: { base: string; quote: string },
): boolean {
  const now = Date.now();
  const maxAgeMs = authenticatedBalanceFreshnessMs();
  const buy = spendableSnapshot(buyVenue, pair.quote);
  const sell = spendableSnapshot(sellVenue, pair.base);
  return Boolean(
    buy && sell &&
    Number.isFinite(buy.lastReconciliationAt) &&
    Number.isFinite(sell.lastReconciliationAt) &&
    now - buy.lastReconciliationAt <= maxAgeMs &&
    now - sell.lastReconciliationAt <= maxAgeMs,
  );
}

/**
 * A pair can be terminal even when both order submissions did not succeed. If
 * one IOC leg was accepted and reaches a terminal state while its counterpart
 * was never submitted, that one-sided exposure is a completed (failed) pair
 * lifecycle and must be learned exactly once, never retried as settlement-unknown.
 */
function finalizeKnownSubmissionFailure(result: ArbitrageExecutionResult): ArbitrageExecutionResult {
  const normalized = result.normalized;
  if (!normalized || normalized.terminal) return result;

  const submittedCount = Number(Boolean(result.buyOrder)) + Number(Boolean(result.sellOrder));
  const settledOrders = result.orders || [];
  const terminalOrders = settledOrders.filter(order => order.terminal);

  if (submittedCount === 0 && (result.status === 'rejected' || result.status === 'failed')) {
    const settledAt = Date.now();
    return {
      ...result,
      success: false,
      normalized: {
        ...normalized,
        status: result.status,
        terminal: true,
        settlementConfirmed: false,
        settledAt,
        provenance: [...new Set([...normalized.provenance, 'pair_submission_terminal_failure'])],
      },
    };
  }

  if (submittedCount !== 1 || settledOrders.length !== 1 || terminalOrders.length !== 1) return result;

  const onlyOrder = terminalOrders[0];
  const hasExposure = (onlyOrder.filledQuantity ?? 0) > 0;
  const status = hasExposure
    ? 'partially_filled' as const
    : result.status === 'rejected' ? 'rejected' as const : 'failed' as const;

  return {
    ...result,
    success: false,
    status,
    settlementConfirmed: true,
    normalized: {
      ...normalized,
      status,
      terminal: true,
      settlementConfirmed: true,
      settledAt: onlyOrder.terminalAt ?? Date.now(),
      provenance: [...new Set([
        ...normalized.provenance,
        `${onlyOrder.venue}:terminal_orphan_leg`,
        'counterpart_submission_failed',
      ])],
      error: result.error || normalized.error || 'One CEX leg failed submission while the counterpart reached a terminal state',
    },
  };
}

async function acquireMeasuredInventory(
  plan: VerifiedArbitragePlan,
  adapters: Partial<Record<ExecutableCexVenue, CexSettlementAdapter>>,
) {
  const pair = splitSpotSymbol(plan.symbol);
  if (!pair) return { reservation: null, rejection: 'REJECT_BALANCE_INSUFFICIENT: unsupported spot symbol for inventory accounting' };
  if (!SUPPORTED_CEX_VENUES.has(plan.buyVenue as ExecutableCexVenue) || !SUPPORTED_CEX_VENUES.has(plan.sellVenue as ExecutableCexVenue)) {
    return { reservation: null, rejection: `REJECT_BALANCE_INSUFFICIENT: unsupported inventory venue pair ${plan.buyVenue}->${plan.sellVenue}` };
  }
  const buyVenue = plan.buyVenue as InventoryVenue;
  const sellVenue = plan.sellVenue as InventoryVenue;
  const buyAdapter = adapters[buyVenue] as BalanceCapableAdapter | undefined;
  const sellAdapter = adapters[sellVenue] as BalanceCapableAdapter | undefined;
  if (!buyAdapter?.getBalances || !sellAdapter?.getBalances) {
    return { reservation: null, rejection: 'REJECT_BALANCE_INSUFFICIENT: live adapter does not expose authenticated balance reconciliation' };
  }

  // The inventory-constrained execution wrapper already performs authenticated
  // balance reconciliation and then re-quotes the opportunity. Re-querying the
  // same private balance endpoints immediately afterward adds latency and CEX
  // traffic without adding truth. Reuse only a very recent authenticated ledger
  // snapshot; otherwise fall back to a fresh concurrent reconciliation here.
  if (!hasFreshAuthenticatedPairInventory(buyVenue, sellVenue, pair)) {
    let buyBalances: Record<string, string>;
    let sellBalances: Record<string, string>;
    try {
      [buyBalances, sellBalances] = await Promise.all([
        buyAdapter.getBalances(),
        sellAdapter.getBalances(),
      ]);
    } catch (error) {
      return {
        reservation: null,
        rejection: `REJECT_BALANCE_INSUFFICIENT: authenticated balance reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    await Promise.all([
      cexInventoryLedger.reconcile(buyVenue, buyBalances),
      cexInventoryLedger.reconcile(sellVenue, sellBalances),
    ]);
  }

  const buyPrice = plan.buyLimitPrice ?? plan.buyAsk;
  const requiredQuote = plan.baseQty * buyPrice + Math.max(0, plan.costs.buyFeeUsd);
  const requirements: InventoryRequirement[] = [
    { venue: buyVenue, asset: pair.quote, amount: requiredQuote },
    { venue: sellVenue, asset: pair.base, amount: plan.baseQty },
  ];
  for (const requirement of requirements) {
    const snapshot = spendableSnapshot(requirement.venue, requirement.asset);
    if (!snapshot) {
      return { reservation: null, rejection: `REJECT_BALANCE_INSUFFICIENT: no reconciled ${requirement.venue} ${requirement.asset} balance` };
    }
    const spendable = snapshot.available - snapshot.reserved - snapshot.payoutReserved - snapshot.pendingOrder - snapshot.pendingTransfer - snapshot.minimumReserve;
    if (!Number.isFinite(spendable) || spendable + 1e-12 < requirement.amount) {
      return {
        reservation: null,
        rejection: `REJECT_BALANCE_INSUFFICIENT: ${requirement.venue} ${requirement.asset} spendable=${Math.max(0, spendable).toFixed(12)} required=${requirement.amount.toFixed(12)}`,
      };
    }
  }

  const reservation = await cexInventoryLedger.reserve(opportunityIdentity(plan), requirements);
  return reservation
    ? { reservation, rejection: null }
    : { reservation: null, rejection: 'REJECT_INVENTORY_RESERVED: atomic quantity-aware inventory reservation unavailable' };
}

async function reconcileTerminalBalances(result: ArbitrageExecutionResult): Promise<void> {
  const orders = result.orders || [];
  await Promise.all(orders.map(async order => {
    if (!order.finalBalances || !SUPPORTED_CEX_VENUES.has(order.venue as ExecutableCexVenue)) return;
    await cexInventoryLedger.reconcile(order.venue as InventoryVenue, order.finalBalances).catch(error => {
      logger.warn('[InventoryLedger] Terminal balance reconciliation degraded', {
        component: 'CentralizedExchangeExecutor', venue: order.venue, orderId: order.orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }));
}

export class CentralizedExchangeExecutor {
  constructor(private readonly options: CexExecutorOptions = {}) {}

  async execute(plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> {
    getCryptocrawlGovernance().requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol });
    if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_EXECUTION=true is required for live orders');
    }
    if (process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK is required for live orders');
    }
    if (plan.bridge) throw new Error('Cross-chain plans require settlement orchestration and cannot be submitted as spot orders');
    if (!SUPPORTED_CEX_VENUES.has(plan.buyVenue as ExecutableCexVenue) || !SUPPORTED_CEX_VENUES.has(plan.sellVenue as ExecutableCexVenue)) {
      throw new Error(`Live execution is not configured for ${plan.buyVenue} -> ${plan.sellVenue}`);
    }
    if (!Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) {
      return rejectPlan('REJECT_NEGATIVE_NET_EDGE: verified all-in net profit must be positive before live CEX submission');
    }

    const executionAdmissionStartedAt = Date.now();
    const adapters: Partial<Record<ExecutableCexVenue, CexSettlementAdapter>> = {
      ...productionCexAdapters,
      ...(this.options.adapters || {}),
    };
    const inventory = await acquireMeasuredInventory(plan, adapters);
    if (!inventory.reservation) return rejectPlan(inventory.rejection || 'REJECT_INVENTORY_RESERVED');

    try {
      const maxQuoteAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
      const quoteFreshness = Math.max(0, Math.min(1, 1 - plan.quoteAgeMs / maxQuoteAgeMs));
      const liquidityCoverage = measuredLiquidityCoverage(plan);
      const calibration = monteCarloCalibrationStore.getSamples({
        topology: 'CEX_CEX',
        venuePair: `${plan.buyVenue}->${plan.sellVenue}`,
        symbol: plan.symbol,
        chain: 'cex',
        strategy: 'verified_cex_arbitrage',
        limit: 1024,
      });
      const empiricalFill = calibration.bothLegsFillRate;
      const evidenceConfidence = empiricalFill !== null
        ? Math.max(0, Math.min(1, empiricalFill * 0.70 + quoteFreshness * 0.20 + liquidityCoverage * 0.10))
        : Math.max(0, Math.min(1, quoteFreshness * liquidityCoverage));

      const monteCarloInput = {
        seed: `cex:${plan.buyVenue}:${plan.sellVenue}:${plan.symbol}:${plan.buyAsk}:${plan.sellBid}:${plan.quoteAgeMs}`,
        topology: 'CEX_CEX' as const,
        notionalUsd: plan.notionalUsd,
        expectedNetProfitUsd: plan.netProfitUsd,
        estimatedExecutionCostUsd: Math.max(0, plan.costs.totalCostsUsd),
        expectedSlippageBps: Math.max(0, plan.expectedSlippageBps ?? 0),
        quoteLatencyMs: Math.max(0, plan.quoteAgeMs),
        quoteMaxAgeMs: maxQuoteAgeMs,
        executionHorizonMs: maxQuoteAgeMs,
        confidence: evidenceConfidence,
        baselineSlippageAlreadyIncluded: true,
        calibrationSamples: calibration.samples,
        measuredProfitResidualsUsd: calibration.profitResidualsUsd,
        measuredCostMultipliers: calibration.costMultipliers,
        measuredSlippageResidualsBps: calibration.slippageResidualsBps,
        measuredLatenciesMs: calibration.latenciesMs,
        measuredJointResiduals: calibration.observations.map(observation => ({
          profitResidualUsd: observation.profitResidualUsd,
          costMultiplier: observation.costMultiplier,
          slippageResidualBps: observation.slippageResidualBps,
          latencyMs: observation.latencyMs,
          bothLegsFilled: observation.bothLegsFilled,
          partialFill: observation.partialFill,
          providerFailure: observation.providerFailure,
        })),
      };
      const monteCarloKey = [
        monteCarloInput.seed,
        plan.baseQty,
        plan.netProfitUsd,
        plan.costs.totalCostsUsd,
        plan.expectedSlippageBps ?? 0,
        calibration.samples,
      ].join(':');
      const monteCarloTtlMs = Math.max(100, Math.min(1000, maxQuoteAgeMs - Math.max(0, plan.quoteAgeMs)));
      let monteCarlo;
      try {
        monteCarlo = await parallelMonteCarloPool.run(monteCarloKey, monteCarloInput, monteCarloTtlMs);
      } catch (error) {
        return rejectPlan(`REJECT_MC_COMPUTE: execution profitability simulation could not complete inside the governed quote window: ${error instanceof Error ? error.message : String(error)}`);
      }

      const empiricalCalibrationAvailable = calibration.samples > 0;
      const coldStartMeasuredBootstrap = !empiricalCalibrationAvailable &&
        plan.netProfitUsd > 0 &&
        plan.liquidity.status === 'measured' &&
        liquidityCoverage >= 1 &&
        quoteFreshness > 0 &&
        Number.isFinite(plan.costs.totalCostsUsd) &&
        Number.isFinite(plan.expectedSlippageBps ?? 0);
      const admissionMode = empiricalCalibrationAvailable
        ? 'empirical_monte_carlo'
        : coldStartMeasuredBootstrap
          ? 'first_terminal_sample_bootstrap'
          : 'cold_start_evidence_incomplete';

      logger.info('Measured CEX profitability forecast evaluated', {
        component: 'CentralizedExchangeExecutor', symbol: plan.symbol,
        buyVenue: plan.buyVenue, sellVenue: plan.sellVenue, topology: 'CEX_CEX',
        verifiedNetProfitUsd: plan.netProfitUsd, quoteFreshness, liquidityCoverage, evidenceConfidence,
        inventoryReservationId: inventory.reservation.reservationId,
        inventoryRequirements: inventory.reservation.requirements,
        calibrationSamples: calibration.samples,
        empiricalCalibrationAvailable,
        admissionMode,
        empiricalBothLegsFillRate: calibration.bothLegsFillRate,
        empiricalPartialFillRate: calibration.partialFillRate,
        empiricalProviderFailureRate: calibration.providerFailureRate,
        profitableProbability: monteCarlo.profitableProbability,
        profitableProbabilityInterval: monteCarlo.profitableProbabilityInterval,
        probabilityBothLegsFill: monteCarlo.probabilityBothLegsFill,
        probabilityLossExceedsThreshold: monteCarlo.probabilityLossExceedsThreshold,
        probabilityPartialFillLoss: monteCarlo.probabilityPartialFillLoss,
        p50NetProfitUsd: monteCarlo.p50NetProfitUsd,
        p25NetProfitUsd: monteCarlo.p25NetProfitUsd,
        p10NetProfitUsd: monteCarlo.p10NetProfitUsd,
        p5NetProfitUsd: monteCarlo.p5NetProfitUsd,
        p1NetProfitUsd: monteCarlo.p1NetProfitUsd,
        worstNetProfitUsd: monteCarlo.worstNetProfitUsd,
        valueAtRisk95Usd: monteCarlo.valueAtRisk95Usd,
        valueAtRisk99Usd: monteCarlo.valueAtRisk99Usd,
        expectedShortfall95Usd: monteCarlo.expectedShortfall95Usd,
        expectedShortfall975Usd: monteCarlo.expectedShortfall975Usd,
        expectedShortfall99Usd: monteCarlo.expectedShortfall99Usd,
        executionHorizonMs: monteCarlo.executionHorizonMs,
        samples: monteCarlo.samples, stoppedEarly: monteCarlo.stoppedEarly, converged: monteCarlo.converged,
        distribution: monteCarlo.distribution, distributionProvenance: monteCarlo.distributionProvenance,
        policyVersion: monteCarlo.policyVersion, approved: monteCarlo.approved, reason: monteCarlo.reason,
        compute: parallelMonteCarloPool.getStatus(),
      });

      if (!monteCarlo.approved && empiricalCalibrationAvailable) {
        return rejectPlan(`REJECT_MC: empirical profitability forecast rejected execution: ${monteCarlo.reason}`);
      }
      if (!monteCarlo.approved && !coldStartMeasuredBootstrap) {
        return rejectPlan(`REJECT_MC_COLD_START_EVIDENCE: no empirical settlement history exists and current measured execution evidence is incomplete: ${monteCarlo.reason}`);
      }
      if (!monteCarlo.approved && coldStartMeasuredBootstrap) {
        logger.warn('Cold-start Monte Carlo retained as advisory evidence for first terminal sample', {
          component: 'CentralizedExchangeExecutor',
          symbol: plan.symbol,
          buyVenue: plan.buyVenue,
          sellVenue: plan.sellVenue,
          calibrationSamples: calibration.samples,
          verifiedNetProfitUsd: plan.netProfitUsd,
          liquidityCoverage,
          quoteFreshness,
          monteCarloApproved: false,
          admissionAuthority: 'measured_current_execution_evidence',
          historyAuthorityAfterExecution: 'terminal_normalized_settlement',
        });
      }

      const effectiveQuoteAgeMs = Math.max(0, plan.quoteAgeMs) + (Date.now() - executionAdmissionStartedAt);
      if (effectiveQuoteAgeMs > maxQuoteAgeMs) {
        return rejectPlan(`REJECT_STALE_QUOTE: effective quote age ${effectiveQuoteAgeMs}ms exceeds ${maxQuoteAgeMs}ms before order submission`);
      }

      try {
        await assertFreshCexProductConstraints(plan);
      } catch (error) {
        return rejectPlan(error instanceof Error ? error.message : `REJECT_PRODUCT_DRIFT: ${String(error)}`);
      }

      getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { pair: plan.symbol });
      const result = finalizeKnownSubmissionFailure(await executeCexPlan(plan, { ...this.options, adapters }));
      await reconcileTerminalBalances(result);
      return result;
    } finally {
      await inventory.reservation.release();
    }
  }
}

const productionCexAdapters = createProductionCexSettlementAdapters();
export const centralizedExchangeExecutor = new CentralizedExchangeExecutor({ adapters: productionCexAdapters });
