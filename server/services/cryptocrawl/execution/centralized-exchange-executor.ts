import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  getProfitLadderNotionalAuthority,
  type ProfitLadderNotionalAuthoritySnapshot,
} from '../governance/profit-ladder-notional-authority.js';
import logger from '../../../logger.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import { cexInventoryLedger, type InventoryRequirement, type InventoryVenue } from './cex-inventory-ledger.js';
import { getExactCoinbaseOrderAssetDeltas } from './coinbase-system-capital-settlement-evidence.js';
import { getExactSystemCapitalOrderAssetDeltas } from './cex-system-capital-settlement-evidence.js';
import { applyExactCexSystemOwnedSettlement } from './cex-system-owned-lot-ledger.js';
import { parallelMonteCarloPool } from './adapters/parallel-monte-carlo-pool.js';
import {
  createProductionCexSettlementAdapters,
  type CexExecutorOptions,
  type CexExecutionResult,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
} from './cex-settlement.js';
import { wrapOkxSettlementAdapterWithConvertAuction } from './okx-convert-settlement-wrapper.js';
import {
  executeHyperHybridCexPlan,
  type HyperHybridCexExecutionResult,
  type HyperHybridChildExecutor,
} from './hyper-hybrid-cex-execution.js';

export type ExchangeOrderReceipt = NonNullable<CexExecutionResult['buyOrder']>;
export type ArbitrageExecutionResult = HyperHybridCexExecutionResult;

type BalanceCapableAdapter = CexSettlementAdapter & {
  getBalances: () => Promise<Record<string, string>>;
};

type CentralizedExchangeExecutorOptions = CexExecutorOptions & {
  /**
   * Optional strategy-specific child lifecycle. Full-parent inventory,
   * governance and ladder admission stay here; only terminal child submission
   * semantics are delegated. Monte Carlo remains parallel advisory evidence and
   * never owns execution admission.
   */
  childExecutor?: HyperHybridChildExecutor;
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
 * Preserve the historic terminalization behavior for non-split/injected adapter
 * paths. Split production children apply the same rule inside the hyper-hybrid
 * executor before their outcomes are aggregated.
 */
function finalizeKnownSubmissionFailure(result: ArbitrageExecutionResult): ArbitrageExecutionResult {
  const normalized = result.normalized;
  if (!normalized || normalized.terminal || result.childExecutions?.length) return result;

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

  // Reuse only a very recent authenticated ledger snapshot; otherwise reconcile
  // both venues concurrently. The FULL parent requirement is reserved before any
  // child is submitted, so splitting can never overcommit capital.
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

async function applyTerminalSystemOwnedSettlements(
  plan: VerifiedArbitragePlan,
  result: ArbitrageExecutionResult,
  notionalAuthority: ProfitLadderNotionalAuthoritySnapshot,
): Promise<void> {
  const terminalFilledOrders = (result.orders || []).filter(order => order.terminal && (order.filledQuantity ?? 0) > 0);
  if (terminalFilledOrders.length === 0) return;

  const reference = `${opportunityIdentity(plan)}:profit-ladder:${notionalAuthority.rungKey}:${notionalAuthority.evaluatedAt}`;
  const authority = {
    strategySelectionAuthority: 'cryptara' as const,
    notionalAuthority: 'profit_ladder' as const,
    executionAuthority: 'stage_manager' as const,
    governanceAdmitted: true as const,
    reference,
    profitLadderRung: notionalAuthority.rungKey,
    profitLadderMaxNotionalUsd: notionalAuthority.maxNotionalUsd,
    admittedParentNotionalUsd: plan.notionalUsd,
    stage: notionalAuthority.stage,
    tierId: notionalAuthority.tierId,
  };

  for (const order of terminalFilledOrders) {
    const evidence = order.venue === 'coinbase'
      ? await getExactCoinbaseOrderAssetDeltas(order)
      : await getExactSystemCapitalOrderAssetDeltas(order);
    await applyExactCexSystemOwnedSettlement({
      evidence,
      opportunityId: opportunityIdentity(plan),
      strategy: 'verified_cex_arbitrage',
      authority,
    });
  }
}

export class CentralizedExchangeExecutor {
  constructor(private readonly options: CentralizedExchangeExecutorOptions = {}) {}

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

    // Profit Ladder is the sole NEW-exposure size authority. Check it again at
    // the live executor boundary so direct callers cannot bypass scheduler/resource
    // admission while preserving the same authority rather than inventing another cap.
    const notionalAuthority = getProfitLadderNotionalAuthority();
    if (
      !Number.isFinite(plan.notionalUsd) || plan.notionalUsd <= 0 ||
      !notionalAuthority.aligned ||
      !(notionalAuthority.maxNotionalUsd > 0) ||
      plan.notionalUsd > notionalAuthority.maxNotionalUsd + 1e-9
    ) {
      return rejectPlan(
        `REJECT_PROFIT_LADDER_NOTIONAL: requested=${plan.notionalUsd} max=${notionalAuthority.maxNotionalUsd} rung=${notionalAuthority.rungKey} aligned=${notionalAuthority.aligned}`,
      );
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

      // Monte Carlo is useful for post-trade calibration and future search/ranking,
      // but it must not consume edge lifetime or veto a deterministic hard-fact
      // positive plan. Run it concurrently and retain its output as advisory
      // evidence only. A compute failure cannot block the current order.
      void parallelMonteCarloPool.run(monteCarloKey, monteCarloInput, monteCarloTtlMs)
        .then(monteCarlo => {
          logger.info('Measured CEX profitability forecast completed as parallel advisory evidence', {
            component: 'CentralizedExchangeExecutor', symbol: plan.symbol,
            buyVenue: plan.buyVenue, sellVenue: plan.sellVenue, topology: 'CEX_CEX',
            verifiedNetProfitUsd: plan.netProfitUsd, quoteFreshness, liquidityCoverage, evidenceConfidence,
            inventoryReservationId: inventory.reservation!.reservationId,
            inventoryRequirements: inventory.reservation!.requirements,
            calibrationSamples: calibration.samples,
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
            policyVersion: monteCarlo.policyVersion, simulationApproved: monteCarlo.approved, reason: monteCarlo.reason,
            compute: parallelMonteCarloPool.getStatus(),
            monteCarloExecutionAuthority: false,
            currentPlanAdmissionAuthority: 'deterministic_positive_all_in_economics_plus_hard_execution_facts',
          });
        })
        .catch(error => {
          logger.debug('Parallel CEX Monte Carlo advisory degraded without blocking execution', {
            component: 'CentralizedExchangeExecutor',
            symbol: plan.symbol,
            buyVenue: plan.buyVenue,
            sellVenue: plan.sellVenue,
            error: error instanceof Error ? error.message : String(error),
            monteCarloExecutionAuthority: false,
            currentPlanAdmissionChanged: false,
          });
        });

      const effectiveQuoteAgeMs = Math.max(0, plan.quoteAgeMs) + (Date.now() - executionAdmissionStartedAt);
      if (effectiveQuoteAgeMs > maxQuoteAgeMs) {
        return rejectPlan(`REJECT_STALE_QUOTE: effective quote age ${effectiveQuoteAgeMs}ms exceeds ${maxQuoteAgeMs}ms before order submission`);
      }

      getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { pair: plan.symbol });
      const result = finalizeKnownSubmissionFailure(await executeHyperHybridCexPlan({
        parent: plan,
        adapters,
        executorOptions: this.options,
        maxQuoteAgeMs,
        executionAdmissionStartedAt,
        // Production uses venue-native FOK for default TT split children. A
        // strategy-specific child executor (e.g. MT/TM maker-first) preserves
        // that strategy's own terminal semantics while sharing this admission.
        useProductionFok: !this.options.adapters && !this.options.childExecutor,
        executeChild: this.options.childExecutor,
      }));
      await reconcileTerminalBalances(result);

      // Injected adapters are test/simulation seams and must never mutate durable
      // capital ownership. Production orders are re-read from the authenticated
      // exchange after terminalization before any owned lots are consumed/created.
      if (!this.options.adapters && process.env.NODE_ENV === 'production') {
        try {
          await applyTerminalSystemOwnedSettlements(plan, result, notionalAuthority);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          getCryptocrawlGovernance().pause('system', 'cex_system_capital_settlement_persistence_failed');
          logger.error('[CEX Executor] Terminal trade truth preserved but system-capital ownership persistence failed; further trading paused', {
            component: 'CentralizedExchangeExecutor',
            symbol: plan.symbol,
            buyVenue: plan.buyVenue,
            sellVenue: plan.sellVenue,
            status: result.status,
            settlementConfirmed: result.settlementConfirmed,
            error: message,
            operatorBalanceFallbackUsed: false,
          });
          return {
            ...result,
            error: result.error || `CEX_SYSTEM_CAPITAL_ACCOUNTING_FAILED:${message}`,
            normalized: result.normalized
              ? {
                  ...result.normalized,
                  provenance: [...new Set([...result.normalized.provenance, 'cex_system_capital_accounting_failed_fail_closed'])],
                  error: result.normalized.error || `System-capital ownership persistence failed after terminal settlement: ${message}`,
                }
              : result.normalized,
          };
        }
      }
      return result;
    } finally {
      await inventory.reservation.release();
    }
  }
}

const productionCexAdapters = createProductionCexSettlementAdapters();
productionCexAdapters.okx = wrapOkxSettlementAdapterWithConvertAuction(productionCexAdapters.okx);
// Production adapters are already merged inside execute(). Leaving options empty
// selects venue-native FOK for default TT split children; strategy-specific
// executors may delegate only child submission while this class retains full-
// parent inventory, governance, ladder and settlement aggregation authority.
// Monte Carlo is always parallel advisory evidence and cannot veto execution.
export const centralizedExchangeExecutor = new CentralizedExchangeExecutor();
