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
}

let latest: OkxRpiFeeOpportunity[] = [];
let timer: NodeJS.Timeout | null = null;
let running = false;

function toOpportunity(capability: OkxRpiExecutionCapability): OkxRpiFeeOpportunity {
  return {
    ...capability,
    minimumNotionalRuleEffectiveDate: '2026-08-18',
    feeSource: 'okx_authenticated_trade_fee',
    authority: 'fee_opportunity_advisory_only',
    executionAuthority: false,
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
        || b.rpiSavingsVsTakerBps - a.rpiSavingsVsTakerBps);

    logger.info('[OKX RPI] Authenticated RPI capability and fee savings advisory refreshed', {
      component: 'OkxRpiFeeAdvisory',
      observedSymbols: symbols.length,
      rpiFeeRowsObserved: latest.length,
      makerPermitted: latest.filter(item => item.makerPermission).length,
      executableFeeAdvantages: latest.filter(item => item.makerPermission && item.executableFeeAdvantage).length,
      visibleRpiLiquidity: latest.filter(item => item.rpiLiquidityVisible).length,
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
 * Non-permitted fee observations remain visible in this module's telemetry but
 * cannot attract route-search budget or masquerade as a capitalizable rebate.
 */
export function getOkxRpiFeeOpportunities(): OkxRpiFeeOpportunity[] {
  return latest
    .filter(item => item.makerPermission && item.executableFeeAdvantage)
    .map(item => ({ ...item }));
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