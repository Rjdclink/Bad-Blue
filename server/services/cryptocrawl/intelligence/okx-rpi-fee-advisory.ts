import logger from '../../../logger.js';
import {
  getOkxRpiExecutionCapability,
  getOkxSpotRpiMinimumNotionalUsd,
  type OkxRpiExecutionCapability,
} from './okx-rpi-capability.js';

export {
  getOkxRpiExecutionCapability,
  getOkxSpotRpiMinimumNotionalUsd,
  isOkxRpiMakerPriceAdmissible,
  type OkxRpiExecutionCapability,
} from './okx-rpi-capability.js';

export interface OkxRpiFeeOpportunity extends OkxRpiExecutionCapability {
  minimumNotionalRuleEffectiveDate: '2026-08-18';
  feeSource: 'okx_authenticated_trade_fee';
  authority: 'fee_opportunity_advisory_only';
  executionAuthority: false;
  rpiTakerAccess: {
    documentedStandardOrderTypes: ['limit', 'market', 'fok', 'ioc'];
    observedAdditionalBidBaseQty: number;
    observedAdditionalAskBaseQty: number;
    liquidityImprovementVisible: boolean;
    permissionProven: false;
    executionAuthority: false;
    reason: 'public_rpi_depth_visible_but_account_taker_permission_not_read_only_provable';
  };
}

let latest: OkxRpiFeeOpportunity[] = [];
let timer: NodeJS.Timeout | null = null;
let running = false;

function sumRpiQty(levels: readonly { rpiQty: number }[]): number {
  return levels.reduce((sum, level) => sum + Math.max(0, Number(level.rpiQty) || 0), 0);
}

function toOpportunity(capability: OkxRpiExecutionCapability): OkxRpiFeeOpportunity {
  const observedAdditionalBidBaseQty = sumRpiQty(capability.rpiBookBids);
  const observedAdditionalAskBaseQty = sumRpiQty(capability.rpiBookAsks);
  return {
    ...capability,
    minimumNotionalRuleEffectiveDate: '2026-08-18',
    feeSource: 'okx_authenticated_trade_fee',
    authority: 'fee_opportunity_advisory_only',
    executionAuthority: false,
    rpiTakerAccess: {
      documentedStandardOrderTypes: ['limit', 'market', 'fok', 'ioc'],
      observedAdditionalBidBaseQty,
      observedAdditionalAskBaseQty,
      liquidityImprovementVisible: observedAdditionalBidBaseQty > 0 || observedAdditionalAskBaseQty > 0,
      permissionProven: false,
      executionAuthority: false,
      reason: 'public_rpi_depth_visible_but_account_taker_permission_not_read_only_provable',
    },
  };
}

async function refresh(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Lazy import keeps execution-time RPI capability independent from this
    // advisory scheduler and prevents intelligence -> integration import cycles.
    const { getCexFourModeSnapshot } = await import('../integration/cex-four-mode-observability-wiring.js');
    const symbols = [...new Set(getCexFourModeSnapshot()
      .sort((a, b) => Number(b.economicallyPositive) - Number(a.economicallyPositive)
        || a.riskAdjustedBpsToBreakEven - b.riskAdjustedBpsToBreakEven)
      .map(mode => mode.symbol))]
      .slice(0, Math.max(1, Math.min(24, Number(process.env.CRYPTO_OKX_RPI_ADVISORY_SYMBOLS || 12))));
    if (symbols.length === 0) return;

    const observed = await Promise.all(symbols.map(symbol => getOkxRpiExecutionCapability(symbol).catch(() => null)));
    latest = observed.filter((item): item is OkxRpiExecutionCapability => item !== null)
      .map(toOpportunity)
      .sort((a, b) => Number(b.executableFeeAdvantage) - Number(a.executableFeeAdvantage)
        || Number(b.rpiTakerAccess.liquidityImprovementVisible) - Number(a.rpiTakerAccess.liquidityImprovementVisible)
        || b.rpiSavingsVsTakerBps - a.rpiSavingsVsTakerBps);

    logger.info('[OKX RPI] Authenticated RPI maker economics and taker-liquidity advisory refreshed', {
      component: 'OkxRpiFeeAdvisory',
      observedSymbols: symbols.length,
      rpiFeeRowsObserved: latest.length,
      makerPermitted: latest.filter(item => item.makerPermission).length,
      executableFeeAdvantages: latest.filter(item => item.makerPermission && item.executableFeeAdvantage).length,
      visibleRpiLiquidity: latest.filter(item => item.rpiLiquidityVisible).length,
      rpiTakerLiquidityImprovementVisible: latest.filter(item => item.rpiTakerAccess.liquidityImprovementVisible).length,
      rpiTakerPermissionProven: false,
      rpiTakerExecutionAuthority: false,
      rpiTakerPolicy: 'prewarm_and_measure_only_until_non_mutating_account_permission_evidence_exists',
      best: latest[0] ?? null,
      capabilityAuthority: 'okx_rpi_capability',
      productIdentityAuthority: 'cex_spot_product_policy',
      quoteCurrencyAllowlistUsed: false,
      spotRpiMinimumNotionalUsd: getOkxSpotRpiMinimumNotionalUsd(),
      executionAuthority: false,
    });
  } finally {
    running = false;
  }
}

/**
 * The profitability/BPS mesh consumes only RPI rows the authenticated account can
 * actually use and whose RPI maker rate improves on standard maker economics.
 * Non-permitted maker rows and the separate RPI-taker depth observation remain
 * advisory. We do not probe taker permission by intentionally sending a live
 * order because a rejected cross-venue leg could create inventory exposure.
 */
export function getOkxRpiFeeOpportunities(): OkxRpiFeeOpportunity[] {
  return latest
    .filter(item => item.makerPermission && item.executableFeeAdvantage)
    .map(item => ({
      ...item,
      rpiBookBids: item.rpiBookBids.map(level => ({ ...level })),
      rpiBookAsks: item.rpiBookAsks.map(level => ({ ...level })),
      rpiTakerAccess: { ...item.rpiTakerAccess, documentedStandardOrderTypes: [...item.rpiTakerAccess.documentedStandardOrderTypes] as ['limit', 'market', 'fok', 'ioc'] },
    }));
}

export function getOkxRpiTakerLiquidityAdvisory(): OkxRpiFeeOpportunity[] {
  return latest
    .filter(item => item.rpiTakerAccess.liquidityImprovementVisible)
    .map(item => ({
      ...item,
      rpiBookBids: item.rpiBookBids.map(level => ({ ...level })),
      rpiBookAsks: item.rpiBookAsks.map(level => ({ ...level })),
      rpiTakerAccess: { ...item.rpiTakerAccess, documentedStandardOrderTypes: [...item.rpiTakerAccess.documentedStandardOrderTypes] as ['limit', 'market', 'fok', 'ioc'] },
    }));
}

export function ensureOkxRpiFeeAdvisory(): void {
  if (timer || process.env.CRYPTO_OKX_RPI_FEE_ADVISORY_ENABLED === 'false') return;
  void refresh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(15_000, Math.min(30 * 60_000, Number(process.env.CRYPTO_OKX_RPI_FEE_ADVISORY_INTERVAL_MS || 120_000)));
    timer = setInterval(() => void refresh(), intervalMs);
    timer.unref?.();
  }
}
