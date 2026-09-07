import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
import { getExactSystemOwnedCexInventory } from './cex-system-owned-lot-ledger.js';

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

export interface OkxMarginShortCollateralProof {
  baseAsset: string;
  quoteAsset: string;
  requiredQuoteAmount: number;
  physicalQuoteAmount: number;
  systemOwnedQuoteAmount: number;
  unexplainedAssets: string[];
  preexistingLiabilityAssets: string[];
  exclusiveSystemOwnedCollateral: boolean;
  observedAt: number;
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

function historyRecoveryWindowMs(): number {
  const value = Number(process.env.CRYPTOCRAWL_OKX_MARGIN_SHORT_HISTORY_RECOVERY_MS || 24 * 60 * 60_000);
  return Math.max(60_000, Math.min(7 * 24 * 60 * 60_000, Number.isFinite(value) ? Math.trunc(value) : 24 * 60 * 60_000));
}

function inverseCollateralBufferFraction(): number {
  const value = Number(process.env.CRYPTOCRAWL_OKX_MARGIN_SHORT_COLLATERAL_BUFFER_FRACTION || 0.25);
  return Math.max(0.05, Math.min(0.50, Number.isFinite(value) ? value : 0.25));
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

function decimalAmount(value: number): string {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error('OKX_MARGIN_SHORT_DECIMAL_AMOUNT_INVALID');
  const text = value.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
  if (!text || text === '0') throw new Error('OKX_MARGIN_SHORT_DECIMAL_AMOUNT_ROUNDED_ZERO');
  return text;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function historyAmount(rows: any[], since: number): number {
  const seen = new Set<string>();
  return rows
    .filter((row: any) => {
      const ts = Number(row?.ts);
      return Number.isFinite(ts) && ts + 5_000 >= since;
    })
    .reduce((sum: number, row: any) => {
      const identity = `${String(row?.ts || '')}:${String(row?.amt || '')}:${String(row?.type || row?.side || '')}:${String(row?.ordId || row?.id || '')}`;
      if (seen.has(identity)) return sum;
      seen.add(identity);
      return sum + Math.max(0, Number(row?.amt) || 0);
    }, 0);
}

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
  if (String(configRow?.acctLv || '') !== '1') return null;
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
  const capabilityReady = tradePermission
    && spotBorrowEnabled
    && autoRepayEnabled
    && noExistingLiability
    && maxBorrowBase + liabilityTolerance(input.baseQuantity) >= input.baseQuantity
    && maxSellBase + liabilityTolerance(input.baseQuantity) >= input.baseQuantity
    && liquidationBufferProven
    && Number.isFinite(projectedBorrowInterestUsd)
    && projectedBorrowInterestUsd >= 0;
  const requiredQuoteAmount = input.baseQuantity * input.referencePriceUsd * (1 + inverseCollateralBufferFraction())
    + Math.max(0, projectedBorrowInterestUsd);
  const collateralProof = capabilityReady
    ? await proveOkxMarginShortSystemOwnedCollateral({ baseAsset, quoteAsset, requiredQuoteAmount }).catch(() => null)
    : null;
  const executable = capabilityReady && collateralProof?.exclusiveSystemOwnedCollateral === true;
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
      ...(collateralProof?.provenance ?? ['okx_inverse_collateral:exclusive_system_owned_proof_unavailable']),
      'borrowed_base_and_short_sale_proceeds:never_system_owned_at_entry',
      'terminal_ownership:only_after_full_liability_repayment_and_realized_pnl',
      'personal_capital_fallback:false',
    ],
  };
}

export async function proveOkxMarginShortSystemOwnedCollateral(input: {
  baseAsset?: string;
  quoteAsset: string;
  requiredQuoteAmount: number;
}): Promise<OkxMarginShortCollateralProof> {
  const baseAsset = input.baseAsset ? canonicalAsset(input.baseAsset) : 'UNSPECIFIED';
  const quoteAsset = canonicalAsset(input.quoteAsset);
  if (baseAsset === quoteAsset) throw new Error('OKX_MARGIN_SHORT_COLLATERAL_ASSET_IDENTITY_INVALID');
  if (!(input.requiredQuoteAmount > 0) || !Number.isFinite(input.requiredQuoteAmount)) {
    throw new Error('OKX_MARGIN_SHORT_REQUIRED_COLLATERAL_INVALID');
  }
  const balance = await okxPrivateRequest('/api/v5/account/balance', 'GET', {}, { lane: 'account_read' });
  const rows = Array.isArray(balance?.data?.[0]?.details) ? balance.data[0].details : [];
  const unexplainedAssets: string[] = [];
  const preexistingLiabilityAssets: string[] = [];
  let physicalQuoteAmount = 0;
  let systemOwnedQuoteAmount = 0;
  for (const row of rows) {
    const rawAsset = String(row?.ccy || '').trim();
    if (!rawAsset) continue;
    const asset = canonicalAsset(rawAsset);
    const physical = Math.max(0, finite(row?.cashBal ?? row?.availBal ?? row?.eq) ?? 0);
    const liability = liabilityAmount(row?.liab) ?? 0;
    const ownedRaw = await getExactSystemOwnedCexInventory('okx', asset);
    const owned = Math.max(0, Number(ownedRaw) || 0);
    const tolerance = Math.max(1e-10, Math.max(physical, owned) * 1e-6);
    if (asset === quoteAsset) {
      if (physical > owned + tolerance) unexplainedAssets.push(asset);
      physicalQuoteAmount = physical;
      systemOwnedQuoteAmount = owned;
    } else if (physical > tolerance) {
      unexplainedAssets.push(asset);
    }
    if (liability > tolerance) preexistingLiabilityAssets.push(asset);
  }
  const requiredTolerance = Math.max(1e-8, input.requiredQuoteAmount * 1e-6);
  const sufficientQuote = physicalQuoteAmount + requiredTolerance >= input.requiredQuoteAmount
    && systemOwnedQuoteAmount + requiredTolerance >= input.requiredQuoteAmount;
  const exclusiveSystemOwnedCollateral = sufficientQuote
    && unexplainedAssets.length === 0
    && preexistingLiabilityAssets.length === 0;
  return {
    baseAsset,
    quoteAsset,
    requiredQuoteAmount: input.requiredQuoteAmount,
    physicalQuoteAmount,
    systemOwnedQuoteAmount,
    unexplainedAssets: [...new Set(unexplainedAssets)].sort(),
    preexistingLiabilityAssets: [...new Set(preexistingLiabilityAssets)].sort(),
    exclusiveSystemOwnedCollateral,
    observedAt: Date.now(),
    provenance: [
      'okx_account_balance:authenticated_all_currency_physical_balance_scan',
      'cex_system_owned_lots:overflow_authoritative_per_asset_ownership',
      ...(input.baseAsset
        ? ['inverse_entry_base_inventory:must_be_zero_so_sell_requires_borrow']
        : ['inverse_base_identity:unspecified_all_nonquote_assets_fail_closed']),
      'nonquote_cross_collateral:must_be_zero_to_prevent_unreserved_exposure',
      'preexisting_liabilities:must_be_zero_before_inverse_open',
      'unexplained_operator_balance:must_be_zero_before_inverse_open',
      'required_quote_collateral:physical_and_system_owned',
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

export async function recoverOkxMarginShortResidualRepayment(input: {
  baseAsset: string;
  expectedPrincipalBase: number;
  maximumRepayableBase: number;
}): Promise<{ liabilityBase: number; manualRepayAttempted: boolean; observedAt: number; provenance: string[] }> {
  const baseAsset = canonicalAsset(input.baseAsset);
  if (!(input.expectedPrincipalBase > 0) || !(input.maximumRepayableBase > 0) ||
      !Number.isFinite(input.expectedPrincipalBase) || !Number.isFinite(input.maximumRepayableBase)) {
    throw new Error('OKX_MARGIN_SHORT_RESIDUAL_REPAY_INPUT_INVALID');
  }
  const tolerance = liabilityTolerance(input.expectedPrincipalBase);
  let liability = await getOkxBaseLiability(baseAsset);
  if (liability.liabilityBase <= tolerance) {
    return {
      liabilityBase: liability.liabilityBase,
      manualRepayAttempted: false,
      observedAt: liability.observedAt,
      provenance: ['okx_balance:terminal_liability_already_zero', 'manual_repay:not_required'],
    };
  }
  if (liability.liabilityBase > input.maximumRepayableBase + tolerance) {
    throw new Error('OKX_MARGIN_SHORT_RESIDUAL_EXCEEDS_AUTHENTICATED_CLOSE_ACQUISITION');
  }

  let postError: unknown = null;
  try {
    await okxPrivateRequest('/api/v5/account/spot-manual-borrow-repay', 'POST', {
      ccy: baseAsset,
      side: 'repay',
      amt: decimalAmount(liability.liabilityBase),
    }, { lane: 'order_write' });
  } catch (error) {
    postError = error;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    liability = await getOkxBaseLiability(baseAsset);
    if (liability.liabilityBase <= tolerance) {
      return {
        liabilityBase: liability.liabilityBase,
        manualRepayAttempted: true,
        observedAt: liability.observedAt,
        provenance: [
          'okx_spot_manual_borrow_repay:attempted_after_terminal_close_fill',
          'okx_balance:terminal_liability_zero',
          'response_loss_resolved_by_authenticated_liability_state',
          'borrowed_base_ownership:false',
        ],
      };
    }
    if (attempt < 5) await sleep(250 * (attempt + 1));
  }
  throw new Error(`OKX_MARGIN_SHORT_RESIDUAL_REPAYMENT_UNPROVEN:${postError instanceof Error ? postError.message : String(postError || 'liability_remains')}`);
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
  const rows = Array.isArray(history?.data) ? history.data : [];
  const primaryBorrowed = historyAmount(rows, input.submittedAt);
  const recoverySince = Math.max(0, Date.now() - historyRecoveryWindowMs());
  const borrowedBase = primaryBorrowed > 0 ? primaryBorrowed : historyAmount(rows, recoverySince);
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
      primaryBorrowed + tolerance >= input.expectedBorrowBase
        ? 'okx_spot_borrow_repay_history:auto_borrow_observed_after_submit'
        : 'okx_spot_borrow_repay_history:auto_borrow_recovered_within_bounded_restart_window',
      'current_liability:must_still_cover_expected_principal',
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
  const [liability, autoHistory, manualHistory] = await Promise.all([
    getOkxBaseLiability(baseAsset),
    okxPrivateRequest('/api/v5/account/spot-borrow-repay-history', 'GET', { ccy: baseAsset, type: 'auto_repay', limit: '100' }, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/spot-borrow-repay-history', 'GET', { ccy: baseAsset, type: 'manual_repay', limit: '100' }, { lane: 'account_read' }).catch(() => ({ data: [] })),
  ]);
  const rows = [
    ...(Array.isArray(autoHistory?.data) ? autoHistory.data : []),
    ...(Array.isArray(manualHistory?.data) ? manualHistory.data : []),
  ];
  const primaryRepaid = historyAmount(rows, input.closeSubmittedAt);
  const recoverySince = Math.max(0, Date.now() - historyRecoveryWindowMs());
  const repaidBase = primaryRepaid > 0 ? primaryRepaid : historyAmount(rows, recoverySince);
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
      primaryRepaid + tolerance >= input.expectedRepayBase
        ? 'okx_spot_borrow_repay_history:auto_or_manual_repay_observed_after_close'
        : 'okx_spot_borrow_repay_history:auto_or_manual_repay_recovered_within_bounded_restart_window',
      'borrowed_base_liability:terminal_zero',
      'short_sale_proceeds:ownership_not_promoted_before_repayment',
    ],
  };
}
