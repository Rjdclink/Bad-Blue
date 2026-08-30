import logger from '../../../logger.js';
import { okxPrivateRequest } from './cex-private-authority.js';
import { getCexFourModeSnapshot } from '../integration/cex-four-mode-observability-wiring.js';

export interface OkxRpiFeeOpportunity {
  symbol: string;
  observedAt: number;
  takerFeeBps: number;
  standardMakerFeeBps: number | null;
  rpiMakerFeeBps: number;
  rpiSavingsVsTakerBps: number;
  rpiSavingsVsStandardMakerBps: number | null;
  minimumRpiNotionalUsd: number;
  minimumNotionalRuleEffectiveDate: '2026-08-18';
  feeSource: 'okx_authenticated_trade_fee';
  authority: 'fee_opportunity_advisory_only';
  executionAuthority: false;
}

let latest: OkxRpiFeeOpportunity[] = [];
let timer: NodeJS.Timeout | null = null;
let running = false;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalInstId(symbol: string): string | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function rateToBps(rate: number): number {
  // OKX reports fees as signed decimal rates: negative = charged fee,
  // positive = rebate. Preserve the economic sign as BPS cost/rebate.
  return -rate * 10_000;
}

function selectFeeRow(row: any): { taker: number; maker: number | null; rpiMaker: number | null } | null {
  const groups = Array.isArray(row?.feeGroup) ? row.feeGroup : [];
  const group = groups.length === 1 ? groups[0] : null;
  const taker = finite(group?.taker ?? row?.taker);
  if (taker === null) return null;
  const maker = finite(group?.maker ?? row?.maker);
  const rpiMaker = finite(group?.rpiMaker ?? group?.elpMaker ?? row?.rpiMaker ?? row?.elpMaker);
  return { taker, maker, rpiMaker };
}

async function observeSymbol(symbol: string): Promise<OkxRpiFeeOpportunity | null> {
  const instId = canonicalInstId(symbol);
  if (!instId) return null;
  const { data } = await okxPrivateRequest('/api/v5/account/trade-fee', 'GET', {
    instType: 'SPOT',
    instId,
  }, { lane: 'trade_fee' });
  const selected = selectFeeRow(data[0]);
  if (!selected || selected.rpiMaker === null) return null;

  const takerFeeBps = rateToBps(selected.taker);
  const standardMakerFeeBps = selected.maker === null ? null : rateToBps(selected.maker);
  const rpiMakerFeeBps = rateToBps(selected.rpiMaker);
  return {
    symbol,
    observedAt: Date.now(),
    takerFeeBps,
    standardMakerFeeBps,
    rpiMakerFeeBps,
    rpiSavingsVsTakerBps: takerFeeBps - rpiMakerFeeBps,
    rpiSavingsVsStandardMakerBps: standardMakerFeeBps === null ? null : standardMakerFeeBps - rpiMakerFeeBps,
    minimumRpiNotionalUsd: Math.max(1_000, Number(process.env.CRYPTO_OKX_RPI_MIN_NOTIONAL_USD || 1_000)),
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
    const symbols = [...new Set(getCexFourModeSnapshot()
      .sort((a, b) => Number(b.economicallyPositive) - Number(a.economicallyPositive)
        || a.riskAdjustedBpsToBreakEven - b.riskAdjustedBpsToBreakEven)
      .map(mode => mode.symbol))]
      .slice(0, Math.max(1, Math.min(12, Number(process.env.CRYPTO_OKX_RPI_ADVISORY_SYMBOLS || 6))));
    if (symbols.length === 0) return;

    const observed = await Promise.all(symbols.map(symbol => observeSymbol(symbol).catch(() => null)));
    latest = observed.filter((item): item is OkxRpiFeeOpportunity => item !== null)
      .sort((a, b) => b.rpiSavingsVsTakerBps - a.rpiSavingsVsTakerBps);

    logger.info('[OKX RPI] Authenticated fee savings advisory refreshed', {
      component: 'OkxRpiFeeAdvisory',
      observedSymbols: symbols.length,
      rpiEligibleObserved: latest.length,
      best: latest[0] ?? null,
      officialRuleEffectiveDate: '2026-08-18',
      spotRpiMinimumNotionalUsd: Math.max(1_000, Number(process.env.CRYPTO_OKX_RPI_MIN_NOTIONAL_USD || 1_000)),
      executionAuthority: false,
    });
  } finally {
    running = false;
  }
}

export function getOkxRpiFeeOpportunities(): OkxRpiFeeOpportunity[] {
  return latest.map(item => ({ ...item }));
}

export function ensureOkxRpiFeeAdvisory(): void {
  if (timer || process.env.CRYPTO_OKX_RPI_FEE_ADVISORY_ENABLED === 'false') return;
  void refresh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(30_000, Math.min(30 * 60_000, Number(process.env.CRYPTO_OKX_RPI_FEE_ADVISORY_INTERVAL_MS || 300_000)));
    timer = setInterval(() => void refresh(), intervalMs);
    timer.unref?.();
  }
}
