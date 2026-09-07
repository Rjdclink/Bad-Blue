import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';

export interface OkxMarginShortEvidence {
  symbol: string;
  exchangeSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  accountMode: 'spot';
  tradePermission: boolean;
  spotBorrowEnabled: boolean;
  autoRepayEnabled: boolean;
  maxBorrowBase: number;
  maxSellBase: number;
  currentLiabilityBase: number;
  hourlyBorrowRate: number;
  projectedBorrowInterestUsd: number;
  adjustedEquityUsd: number | null;
  maintenanceMarginUsd: number;
  marginRatio: number | null;
  liquidationBufferProven: boolean;
  executable: boolean;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface OkxMarginShortHealth {
  baseAsset: string;
  expectedPrincipalBase: number;
  liabilityBase: number;
  adjustedEquityUsd: number | null;
  maintenanceMarginUsd: number;
  marginRatio: number | null;
  tradePermission: boolean;
  spotBorrowEnabled: boolean;
  autoRepayEnabled: boolean;
  liabilityPresent: boolean;
  liquidationBufferProven: boolean;
  healthy: boolean;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function canonicalAsset(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!value || !/^[A-Z0-9]+$/.test(value)) throw new Error(`Invalid OKX margin-short asset ${raw}`);
  return value;
}

function liabilityAmount(raw: unknown): number | null {
  const value = finite(raw);
  return value === null ? null : Math.abs(value);
}

function liabilityTolerance(quantity: number): number {
  return Math.max(1e-10, Math.abs(quantity) * 1e-6);
}

function evidenceTtlMs(): number {
  const value = Number(process.env.CRYPTOCRAWL_OKX_MARGIN_SHORT_EVIDENCE_TTL_MS || 3_000);
  return Math.max(500, Math.min(10_000, Number.isFinite(value) ? Math.trunc(value) : 3_000));
}

function minimumMarginRatio(): number {
  const value = Number(process.env.CRYPTOCRAWL_OKX_MARGIN_SHORT_MIN_MARGIN_RATIO || 3);
  return Math.max(1.25, Math.min(20, Number.isFinite(value) ? value : 3));
}

function findCurrencyDetail(balance: any, asset: string): any | null {
  const rows = Array.isArray(balance?.data?.[0]?.details) ? balance.data[0].details : [];
  return rows.find((row: any) => String(row?.ccy || '').trim().toUpperCase() === asset) ?? null;
}

function maxLoanForBase(response: any, baseAsset: string): number | null {
  const rows = Array.isArray(response?.data) ? response.data : [];
  const normalized = baseAsset.toUpperCase();
  const candidates = rows.filter((row: any) => {
    const ccy = String(row?.ccy || row?.mgnCcy || '').trim().toUpperCase();
    const side = String(row?.side || '').trim().toLowerCase();
    return (!ccy || ccy === normalized) && (!side || side === 'sell');
  });
  const values = candidates.map((row: any) => nonnegative(row?.maxLoan)).filter((value): value is number => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

function interestRateForBase(response: any, baseAsset: string): number | null {
  const rows = Array.isArray(response?.data) ? response.data : [];
  const row = rows.find((item: any) => String(item?.ccy || '').trim().toUpperCase() === baseAsset.toUpperCase());
  return row ? nonnegative(row?.interestRate) : null;
}

function configFlags(configRow: any): { tradePermission: boolean; spotBorrowEnabled: boolean; autoRepayEnabled: boolean } {
  return {
    tradePermission: String(configRow?.perm || '').split(',').map((value: string) => value.trim()).includes('trade'),
    spotBorrowEnabled: configRow?.enableSpotBorrow === true || String(configRow?.enableSpotBorrow).toLowerCase() === 'true',
    autoRepayEnabled: configRow?.spotBorrowAutoRepay === true || String(configRow?.spotBorrowAutoRepay).toLowerCase() === 'true',
  };
}

function liveLiquidationBuffer(input: {
  liabilityPresent: boolean;
  adjustedEquityUsd: number | null;
  maintenanceMarginUsd: number;
  marginRatio: number | null;
}): boolean {
  if (!input.liabilityPresent) return input.maintenanceMarginUsd <= 1e-9;
  if (input.marginRatio !== null && input.marginRatio >= minimumMarginRatio()) return true;
  return input.adjustedEquityUsd !== null
    && input.maintenanceMarginUsd > 0
    && input.adjustedEquityUsd >= input.maintenanceMarginUsd * Math.max(1.5, minimumMarginRatio() / 2);
}

/**
 * Proves the exact inverse-hedge borrowing surface without creating a loan.
 * This authority intentionally supports OKX Spot-mode borrowing first because
 * current OKX APIs expose explicit enableSpotBorrow/spotBorrowAutoRepay state,
 * max-loan, max-sell and hourly interest evidence for that mode. Other account
 * modes remain fail closed until equivalent liability isolation is proven.
 */
export async function measureOkxMarginShortEvidence(input: {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseQuantity: number;
  referencePriceUsd: number;
  holdUntil: number;
}): Promise<OkxMarginShortEvidence | null> {
  const baseAsset = canonicalAsset(input.baseAsset);
  const quoteAsset = canonicalAsset(input.quoteAsset);
  if (!(input.baseQuantity > 0) || !Number.isFinite(input.baseQuantity)) return null;
  if (!(input.referencePriceUsd > 0) || !Number.isFinite(input.referencePriceUsd)) return null;
  if (!(input.holdUntil > Date.now()) || !Number.isFinite(input.holdUntil)) return null;

  const constraints = await getSpotProductConstraints('okx', input.symbol, true);
  const [config, balance, maxLoan, maxAvail, rates] = await Promise.all([
    okxPrivateRequest('/api/v5/account/config', 'GET', {}, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/balance', 'GET', { ccy: baseAsset }, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/max-loan', 'GET', { instId: constraints.exchangeSymbol, mgnMode: 'cross' }, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/max-avail-size', 'GET', { instId: constraints.exchangeSymbol, tdMode: 'cross' }, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/interest-rate', 'GET', { ccy: baseAsset }, { lane: 'account_read' }),
  ]);

  const configRow = config?.data?.[0] ?? null;
  const accountRow = balance?.data?.[0] ?? null;
  const detail = findCurrencyDetail(balance, baseAsset);
  const accountMode = String(configRow?.acctLv || '');
  if (accountMode !== '1') return null;
  const { tradePermission, spotBorrowEnabled, autoRepayEnabled } = configFlags(configRow);
  const maxBorrowBase = maxLoanForBase(maxLoan, baseAsset);
  const maxSellBase = nonnegative(maxAvail?.data?.[0]?.availSell);
  const currentLiabilityBase = liabilityAmount(detail?.liab);
  const hourlyBorrowRate = interestRateForBase(rates, baseAsset);
  const adjustedEquityUsd = nonnegative(accountRow?.adjEq ?? accountRow?.totalEq);
  const maintenanceMarginUsd = nonnegative(accountRow?.mmr) ?? 0;
  const rawMarginRatio = finite(accountRow?.mgnRatio);
  const marginRatio = rawMarginRatio !== null && rawMarginRatio > 0 ? rawMarginRatio : null;
  if (maxBorrowBase === null || maxSellBase === null || currentLiabilityBase === null || hourlyBorrowRate === null) return null;

  const hours = Math.max(1, Math.ceil((input.holdUntil - Date.now()) / 3_600_000));
  const projectedBorrowInterestUsd = input.baseQuantity * input.referencePriceUsd * hourlyBorrowRate * hours;
  const noExistingLiability = currentLiabilityBase <= liabilityTolerance(input.baseQuantity);
  const liquidationBufferProven = liveLiquidationBuffer({
    liabilityPresent: !noExistingLiability,
    adjustedEquityUsd,
    maintenanceMarginUsd,
    marginRatio,
  });
  const executable = tradePermission
    && spotBorrowEnabled
    && autoRepayEnabled
    && noExistingLiability
    && maxBorrowBase + liabilityTolerance(input.baseQuantity) >= input.baseQuantity
    && maxSellBase + liabilityTolerance(input.baseQuantity) >= input.baseQuantity
    && liquidationBufferProven
    && Number.isFinite(projectedBorrowInterestUsd)
    && projectedBorrowInterestUsd >= 0;
  const observedAt = Date.now();
  return {
    symbol: input.symbol,
    exchangeSymbol: constraints.exchangeSymbol,
    baseAsset,
    quoteAsset,
    accountMode: 'spot',
    tradePermission,
    spotBorrowEnabled,
    autoRepayEnabled,
    maxBorrowBase,
    maxSellBase,
    currentLiabilityBase,
    hourlyBorrowRate,
    projectedBorrowInterestUsd,
    adjustedEquityUsd,
    maintenanceMarginUsd,
    marginRatio,
    liquidationBufferProven,
    executable,
    observedAt,
    expiresAt: observedAt + evidenceTtlMs(),
    provenance: [
      'okx_account_config:authenticated_spot_borrow_and_auto_repay',
      'okx_max_loan:authenticated_cross_margin_base_sell_capacity',
      'okx_max_avail_size:authenticated_cross_margin_sell_capacity',
      'okx_interest_rate:authenticated_hourly_borrow_rate',
      'okx_account_balance:authenticated_liability_and_margin_risk',
      'preexisting_base_liability:must_be_zero_for_lifecycle_attribution',
      `okx_margin_ratio_minimum:${minimumMarginRatio()}`,
      'borrowed_base_and_short_sale_proceeds:never_system_owned_at_entry',
      'terminal_ownership:only_after_full_liability_repayment_and_realized_pnl',
      'personal_capital_fallback:false',
    ],
  };
}

export async function getOkxBaseLiability(baseAssetRaw: string): Promise<{ liabilityBase: number; observedAt: number }> {
  const baseAsset = canonicalAsset(baseAssetRaw);
  const balance = await okxPrivateRequest('/api/v5/account/balance', 'GET', { ccy: baseAsset }, { lane: 'account_read' });
  const detail = findCurrencyDetail(balance, baseAsset);
  const liabilityBase = liabilityAmount(detail?.liab);
  if (liabilityBase === null) throw new Error('OKX_MARGIN_SHORT_LIABILITY_UNAVAILABLE');
  return { liabilityBase, observedAt: Date.now() };
}

export async function assessOkxMarginShortHealth(input: {
  baseAsset: string;
  expectedPrincipalBase: number;
}): Promise<OkxMarginShortHealth> {
  const baseAsset = canonicalAsset(input.baseAsset);
  if (!(input.expectedPrincipalBase > 0) || !Number.isFinite(input.expectedPrincipalBase)) {
    throw new Error('OKX_MARGIN_SHORT_EXPECTED_PRINCIPAL_INVALID');
  }
  const [config, balance] = await Promise.all([
    okxPrivateRequest('/api/v5/account/config', 'GET', {}, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/balance', 'GET', { ccy: baseAsset }, { lane: 'account_read' }),
  ]);
  const configRow = config?.data?.[0] ?? null;
  if (String(configRow?.acctLv || '') !== '1') throw new Error('OKX_MARGIN_SHORT_ACCOUNT_MODE_CHANGED');
  const { tradePermission, spotBorrowEnabled, autoRepayEnabled } = configFlags(configRow);
  const accountRow = balance?.data?.[0] ?? null;
  const detail = findCurrencyDetail(balance, baseAsset);
  const liabilityBase = liabilityAmount(detail?.liab);
  if (liabilityBase === null) throw new Error('OKX_MARGIN_SHORT_LIABILITY_UNAVAILABLE');
  const adjustedEquityUsd = nonnegative(accountRow?.adjEq ?? accountRow?.totalEq);
  const maintenanceMarginUsd = nonnegative(accountRow?.mmr) ?? 0;
  const rawMarginRatio = finite(accountRow?.mgnRatio);
  const marginRatio = rawMarginRatio !== null && rawMarginRatio > 0 ? rawMarginRatio : null;
  const tolerance = liabilityTolerance(input.expectedPrincipalBase);
  const liabilityPresent = liabilityBase > tolerance;
  const principalStillRepresented = liabilityBase + tolerance >= input.expectedPrincipalBase * 0.90;
  const liquidationBufferProven = liveLiquidationBuffer({ liabilityPresent, adjustedEquityUsd, maintenanceMarginUsd, marginRatio });
  const healthy = tradePermission
    && spotBorrowEnabled
    && autoRepayEnabled
    && liabilityPresent
    && principalStillRepresented
    && liquidationBufferProven;
  const observedAt = Date.now();
  return {
    baseAsset,
    expectedPrincipalBase: input.expectedPrincipalBase,
    liabilityBase,
    adjustedEquityUsd,
    maintenanceMarginUsd,
    marginRatio,
    tradePermission,
    spotBorrowEnabled,
    autoRepayEnabled,
    liabilityPresent,
    liquidationBufferProven,
    healthy,
    observedAt,
    expiresAt: observedAt + evidenceTtlMs(),
    provenance: [
      'okx_margin_short_health:authenticated_account_config_and_balance',
      'okx_margin_short_liability:must_remain_present_until_close',
      `okx_margin_ratio_minimum:${minimumMarginRatio()}`,
      'borrowed_base_ownership:false',
      'short_sale_proceeds:encumbered_until_terminal_repayment',
    ],
  };
}

export async function proveOkxMarginShortBorrow(input: {
  baseAsset: string;
  expectedBorrowBase: number;
  submittedAt: number;
}): Promise<{ liabilityBase: number; borrowedBase: number; observedAt: number; provenance: string[] }> {
  const baseAsset = canonicalAsset(input.baseAsset);
  const [liability, history] = await Promise.all([
    getOkxBaseLiability(baseAsset),
    okxPrivateRequest('/api/v5/account/spot-borrow-repay-history', 'GET', { ccy: baseAsset, type: 'auto_borrow', limit: '100' }, { lane: 'account_read' }),
  ]);
  const borrowedBase = (Array.isArray(history?.data) ? history.data : [])
    .filter((row: any) => Number(row?.ts) + 5_000 >= input.submittedAt)
    .reduce((sum: number, row: any) => sum + Math.max(0, Number(row?.amt) || 0), 0);
  const tolerance = liabilityTolerance(input.expectedBorrowBase);
  if (liability.liabilityBase + tolerance < input.expectedBorrowBase || borrowedBase + tolerance < input.expectedBorrowBase) {
    throw new Error('OKX_MARGIN_SHORT_BORROW_NOT_PROVEN');
  }
  return {
    liabilityBase: liability.liabilityBase,
    borrowedBase,
    observedAt: Math.max(liability.observedAt, Date.now()),
    provenance: [
      'okx_balance:base_liability_observed',
      'okx_spot_borrow_repay_history:auto_borrow_observed',
      'preexisting_base_liability:zero_required',
      'borrowed_base_ownership:false',
    ],
  };
}

export async function proveOkxMarginShortRepaid(input: {
  baseAsset: string;
  expectedRepayBase: number;
  closeSubmittedAt: number;
}): Promise<{ liabilityBase: number; repaidBase: number; observedAt: number; provenance: string[] }> {
  const baseAsset = canonicalAsset(input.baseAsset);
  const [liability, history] = await Promise.all([
    getOkxBaseLiability(baseAsset),
    okxPrivateRequest('/api/v5/account/spot-borrow-repay-history', 'GET', { ccy: baseAsset, type: 'auto_repay', limit: '100' }, { lane: 'account_read' }),
  ]);
  const repaidBase = (Array.isArray(history?.data) ? history.data : [])
    .filter((row: any) => Number(row?.ts) + 5_000 >= input.closeSubmittedAt)
    .reduce((sum: number, row: any) => sum + Math.max(0, Number(row?.amt) || 0), 0);
  const tolerance = liabilityTolerance(input.expectedRepayBase);
  if (liability.liabilityBase > tolerance || repaidBase + tolerance < input.expectedRepayBase) {
    throw new Error('OKX_MARGIN_SHORT_REPAYMENT_NOT_PROVEN');
  }
  return {
    liabilityBase: liability.liabilityBase,
    repaidBase,
    observedAt: Math.max(liability.observedAt, Date.now()),
    provenance: [
      'okx_balance:base_liability_cleared',
      'okx_spot_borrow_repay_history:auto_repay_observed',
      'borrowed_base_liability:terminal_zero',
      'short_sale_proceeds:ownership_not_promoted_before_repayment',
    ],
  };
}
