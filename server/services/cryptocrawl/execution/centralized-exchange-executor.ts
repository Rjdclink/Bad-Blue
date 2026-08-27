import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import logger from '../../../logger.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import { cexInventoryLedger, type InventoryRequirement, type InventoryVenue } from './cex-inventory-ledger.js';
import { runProfitabilityMonteCarlo } from './adapters/monte-carlo-profitability.js';
import {
  createProductionCexSettlementAdapters,
  executeCexPlan,
  type CexExecutorOptions,
  type CexExecutionResult,
  type CexSettlementAdapter,
} from './cex-settlement.js';

export type ExchangeOrderReceipt = NonNullable<CexExecutionResult['buyOrder']>;
export type ArbitrageExecutionResult = CexExecutionResult;

type BalanceCapableAdapter = CexSettlementAdapter & {
  getBalances?: () => Promise<Record<string, string>>;
};

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

async function acquireMeasuredInventory(
  plan: VerifiedArbitragePlan,
  adapters: Partial<Record<'kraken' | 'okx', CexSettlementAdapter>>,
) {
  const pair = splitSpotSymbol(plan.symbol);
  if (!pair) return { reservation: null, rejection: 'REJECT_BALANCE_INSUFFICIENT: unsupported spot symbol for inventory accounting' };
  const buyVenue = plan.buyVenue as InventoryVenue;
  const sellVenue = plan.sellVenue as InventoryVenue;
  const buyAdapter = adapters[buyVenue] as BalanceCapableAdapter | undefined;
  const sellAdapter = adapters[sellVenue] as BalanceCapableAdapter | undefined;
  if (!buyAdapter?.getBalances || !sellAdapter?.getBalances) {
    return { reservation: null, rejection: 'REJECT_BALANCE_INSUFFICIENT: live adapter does not expose authenticated balance reconciliation' };
  }

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
    const spendable = snapshot.available - snapshot.reserved - snapshot.pendingOrder - snapshot.pendingTransfer - snapshot.minimumReserve;
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
    if (!order.finalBalances || (order.venue !== 'kraken' && order.venue !== 'okx')) return;
    await cexInventoryLedger.reconcile(order.venue, order.finalBalances).catch(error => {
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
    if (!['kraken', 'okx'].includes(plan.buyVenue) || !['kraken', 'okx'].includes(plan.sellVenue)) {
      throw new Error(`Live execution is not configured for ${plan.buyVenue} -> ${plan.sellVenue}`);
    }
    if (!Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) {
      return rejectPlan('REJECT_NEGATIVE_NET_EDGE: verified all-in net profit must be positive before live CEX submission');
    }

    const adapters = this.options.adapters || productionCexAdapters;
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

      const monteCarlo = runProfitabilityMonteCarlo({
        seed: `cex:${plan.buyVenue}:${plan.sellVenue}:${plan.symbol}:${plan.buyAsk}:${plan.sellBid}:${plan.quoteAgeMs}`,
        topology: 'CEX_CEX',
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
      });

      logger.info('Measured CEX profitability forecast evaluated', {
        component: 'CentralizedExchangeExecutor', symbol: plan.symbol,
        buyVenue: plan.buyVenue, sellVenue: plan.sellVenue, topology: 'CEX_CEX',
        verifiedNetProfitUsd: plan.netProfitUsd, quoteFreshness, liquidityCoverage, evidenceConfidence,
        inventoryReservationId: inventory.reservation.reservationId,
        inventoryRequirements: inventory.reservation.requirements,
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
        policyVersion: monteCarlo.policyVersion, approved: monteCarlo.approved, reason: monteCarlo.reason,
      });

      if (!monteCarlo.approved) {
        return rejectPlan(`REJECT_MC: measured profitability forecast rejected execution: ${monteCarlo.reason}`);
      }

      const result = await executeCexPlan(plan, { ...this.options, adapters });
      await reconcileTerminalBalances(result);
      return result;
    } finally {
      await inventory.reservation.release();
    }
  }
}

const productionCexAdapters = createProductionCexSettlementAdapters();
export const centralizedExchangeExecutor = new CentralizedExchangeExecutor({ adapters: productionCexAdapters });
