import logger from '../../../logger.js';
import {
  getCoinbaseAppAccounts,
  getCoinbaseAppTransactions,
} from './coinbase-app-read-authority.js';

export type CoinbaseReceivedFeeRecoverySource =
  | 'coinbase_one_subscription_rebate_received'
  | 'coinbase_explicit_fee_incentive_received';

export type CoinbaseRebateCurrency = 'USDC' | 'EURC';

export type CoinbaseRebateProgramScope =
  | 'current_advanced_account'
  | 'conditional_membership'
  | 'conditional_region'
  | 'institutional_exchange'
  | 'institutional_prime'
  | 'international_exchange'
  | 'onchain_membership';

export interface CoinbaseRebateProgramReference {
  key: string;
  scope: CoinbaseRebateProgramScope;
  runtimeEconomicAuthority: boolean;
  automaticallyObserved: boolean;
  preTradeCreditAllowed: boolean;
  note: string;
}

export interface CoinbaseReceivedFeeRecovery {
  venue: 'coinbase';
  source: CoinbaseReceivedFeeRecoverySource;
  externalId: string;
  currency: CoinbaseRebateCurrency;
  amount: number;
  amountUsd: number | null;
  requiresUsdNormalization: boolean;
  observedAt: number;
  received: true;
  preTradeEconomicAuthority: false;
  realizedRecoveryAuthority: true;
  transactionType: 'subscription_rebate' | 'incentives_rewards_payout';
  provenance: string[];
}

const REFRESH_MS = Math.max(15_000, Math.min(15 * 60_000, Number(process.env.CRYPTOCRAWL_COINBASE_REBATE_REFRESH_MS || 60_000)));
const MAX_ROWS = Math.max(100, Math.min(5_000, Math.trunc(Number(process.env.CRYPTOCRAWL_COINBASE_REBATE_ROWS || 1_000))));

let refreshAt = 0;
let inFlight: Promise<CoinbaseReceivedFeeRecovery[]> | null = null;
let appReadReady: boolean | null = null;
let lastError: string | null = null;
const received = new Map<string, CoinbaseReceivedFeeRecovery>();

export function getCoinbaseRebateProgramCatalog(): CoinbaseRebateProgramReference[] {
  return [
    {
      key: 'coinbase_advanced_authenticated_fee_tier',
      scope: 'current_advanced_account',
      runtimeEconomicAuthority: true,
      automaticallyObserved: true,
      preTradeCreditAllowed: true,
      note: 'Any Advanced/VIP/status-match/liquidity improvement is usable only after the authenticated transaction-summary fee surface proves the actual maker/taker rates.',
    },
    {
      key: 'coinbase_one_advanced_spot_fee_rebate',
      scope: 'conditional_membership',
      runtimeEconomicAuthority: false,
      automaticallyObserved: true,
      preTradeCreditAllowed: false,
      note: 'Coinbase One Advanced spot fee rebates are admitted only after a completed authenticated subscription_rebate credit is received; public plan percentages and caps never create pre-trade profitability.',
    },
    {
      key: 'coinbase_eea_price_improvement_trade_rebate',
      scope: 'conditional_region',
      runtimeEconomicAuthority: false,
      automaticallyObserved: true,
      preTradeCreditAllowed: false,
      note: 'EEA price-improvement rebates are paid in EURC. The observer can retain an explicit completed EURC rebate/incentive credit if Coinbase exposes one, but region, eligibility, and future price improvement are never assumed.',
    },
    {
      key: 'coinbase_exchange_institutional_stablecoin_fee_rebates',
      scope: 'institutional_exchange',
      runtimeEconomicAuthority: false,
      automaticallyObserved: false,
      preTradeCreditAllowed: false,
      note: 'Coinbase Exchange institutional stablecoin rebate credits can offset eligible fees only for enrolled eligible Exchange clients. Current Advanced credentials do not establish enrollment, balance eligibility, rate, accrued credit, or payout.',
    },
    {
      key: 'coinbase_prime_institutional_stablecoin_rebates',
      scope: 'institutional_prime',
      runtimeEconomicAuthority: false,
      automaticallyObserved: false,
      preTradeCreditAllowed: false,
      note: 'Prime stablecoin rebate programs remain outside current Advanced execution authority until authenticated Prime enrollment and realized credits are independently proven.',
    },
    {
      key: 'coinbase_exchange_liquidity_program',
      scope: 'institutional_exchange',
      runtimeEconomicAuthority: false,
      automaticallyObserved: false,
      preTradeCreditAllowed: false,
      note: 'Coinbase Exchange liquidity-program fee reductions are not copied into Advanced economics. They become usable only if the actual executing account/product proves the resulting authenticated fee surface.',
    },
    {
      key: 'coinbase_international_exchange_liquidity_maker_rebate',
      scope: 'international_exchange',
      runtimeEconomicAuthority: false,
      automaticallyObserved: false,
      preTradeCreditAllowed: false,
      note: 'International Exchange can expose zero/negative maker economics and real-time fill rebates, but it is a distinct venue/account surface and is excluded until current credentials and product eligibility prove executable access.',
    },
    {
      key: 'coinbase_international_jumpstart_fee_tier',
      scope: 'international_exchange',
      runtimeEconomicAuthority: false,
      automaticallyObserved: false,
      preTradeCreditAllowed: false,
      note: 'Jumpstart can accelerate International Exchange liquidity-tier eligibility using external volume/open-interest proof, but it is not a rebate and cannot alter current Advanced economics without authenticated enrollment and resulting fee evidence.',
    },
    {
      key: 'coinbase_one_base_gas_sponsorship',
      scope: 'onchain_membership',
      runtimeEconomicAuthority: false,
      automaticallyObserved: false,
      preTradeCreditAllowed: false,
      note: 'Coinbase One Base gas sponsorship is an execution-cost benefit, not spot fee authority. It may reduce realized gas only when the exact transaction proves sponsored gas; membership or public monthly limits are never pre-credited.',
    },
    {
      key: 'coinbase_referral_or_new_user_promotions',
      scope: 'conditional_membership',
      runtimeEconomicAuthority: false,
      automaticallyObserved: false,
      preTradeCreditAllowed: false,
      note: 'Referral, signup, funding, and holding-period promotions are deliberately excluded from recurring proprietary-trading economics and cannot manufacture a profitable trade.',
    },
  ];
}

function positive(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 10_000_000_000 ? Math.trunc(value * 1_000) : Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function normalizedText(row: any): string {
  return [
    row?.description,
    row?.details?.title,
    row?.details?.subtitle,
    row?.details?.header,
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean).join(' | ');
}

function explicitFeeIncentive(row: any): boolean {
  if (String(row?.type || '').trim().toLowerCase() !== 'incentives_rewards_payout') return false;
  const text = normalizedText(row);
  return /rebate|price improvement/.test(text) && /(fee|trading|advanced|trade|price improvement)/.test(text);
}

function parseReceived(row: any): CoinbaseReceivedFeeRecovery | null {
  const type = String(row?.type || '').trim().toLowerCase();
  const source: CoinbaseReceivedFeeRecoverySource | null = type === 'subscription_rebate'
    ? 'coinbase_one_subscription_rebate_received'
    : explicitFeeIncentive(row) ? 'coinbase_explicit_fee_incentive_received' : null;
  if (!source) return null;
  if (String(row?.status || '').trim().toLowerCase() !== 'completed') return null;

  const externalId = String(row?.id || '').trim();
  const currency = String(row?.amount?.currency || '').trim().toUpperCase();
  const amount = positive(row?.amount?.amount);
  if (!externalId || (currency !== 'USDC' && currency !== 'EURC') || amount === null) return null;
  if (source === 'coinbase_one_subscription_rebate_received' && currency !== 'USDC') return null;

  const nativeCurrency = String(row?.native_amount?.currency || '').trim().toUpperCase();
  const nativeAmount = positive(row?.native_amount?.amount);
  const amountUsd = nativeCurrency === 'USD' && nativeAmount !== null ? nativeAmount : null;
  return {
    venue: 'coinbase',
    source,
    externalId,
    currency: currency as CoinbaseRebateCurrency,
    amount,
    amountUsd,
    requiresUsdNormalization: amountUsd === null,
    observedAt: timestamp(row?.updated_at || row?.created_at),
    received: true,
    preTradeEconomicAuthority: false,
    realizedRecoveryAuthority: true,
    transactionType: type as 'subscription_rebate' | 'incentives_rewards_payout',
    provenance: [
      'coinbase_app_v2:authenticated_view',
      `coinbase_transaction_type:${type}`,
      'coinbase_credit_status:completed',
      `coinbase_credit_currency:${currency}`,
      amountUsd !== null ? 'coinbase_native_amount:USD' : 'usd_normalization:required',
      'future_rebate_precredited:false',
      'realized_fee_recovery:received_only',
    ],
  };
}

function trim(): void {
  if (received.size <= MAX_ROWS) return;
  const rows = [...received.entries()].sort((left, right) => left[1].observedAt - right[1].observedAt);
  for (const [key] of rows.slice(0, rows.length - MAX_ROWS)) received.delete(key);
}

export async function refreshCoinbaseReceivedFeeRecoveries(force = false): Promise<CoinbaseReceivedFeeRecovery[]> {
  const now = Date.now();
  if (!force && refreshAt + REFRESH_MS > now) return [...received.values()].map(row => ({ ...row, provenance: [...row.provenance] }));
  if (inFlight) return (await inFlight).map(row => ({ ...row, provenance: [...row.provenance] }));

  inFlight = (async () => {
    const accounts = await getCoinbaseAppAccounts();
    const rebateAccounts = accounts.filter(account => account.currency === 'USDC' || account.currency === 'EURC');
    if (rebateAccounts.length === 0) throw new Error('Coinbase App API did not expose a USDC or EURC account for rebate evidence');

    const outcomes = await Promise.allSettled(rebateAccounts.map(account => getCoinbaseAppTransactions(account.id)));
    let successfulReads = 0;
    for (const outcome of outcomes) {
      if (outcome.status !== 'fulfilled') continue;
      successfulReads += 1;
      for (const row of outcome.value) {
        const parsed = parseReceived(row);
        if (parsed) received.set(`${parsed.source}:${parsed.externalId}`, parsed);
      }
    }
    if (successfulReads === 0) {
      const errors = outcomes.flatMap(outcome => outcome.status === 'rejected'
        ? [outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)]
        : []);
      throw new Error(`Coinbase rebate transaction reads failed: ${errors.join(' | ')}`);
    }
    trim();
    refreshAt = Date.now();
    appReadReady = true;
    lastError = null;
    return [...received.values()];
  })().catch(error => {
    appReadReady = false;
    lastError = error instanceof Error ? error.message : String(error);
    logger.debug('[Coinbase Rebate] Realized rebate scan unavailable; future rebate remains uncredited', {
      component: 'CoinbaseFeeRebateAuthority',
      error: lastError,
      retainedReceivedRows: received.size,
      futureRebatePrecredited: false,
      stablecoinParAssumptionAllowed: false,
    });
    return [...received.values()];
  }).finally(() => { inFlight = null; });

  return (await inFlight).map(row => ({ ...row, provenance: [...row.provenance] }));
}

export function getCoinbaseFeeRebateSnapshot() {
  const rows = [...received.values()].sort((left, right) => right.observedAt - left.observedAt);
  const realizedUsd = rows.reduce((sum, row) => sum + (row.amountUsd ?? 0), 0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthRows = rows.filter(row => row.observedAt >= monthStart.getTime());
  const monthToDateUsd = monthRows.reduce((sum, row) => sum + (row.amountUsd ?? 0), 0);
  const programCatalog = getCoinbaseRebateProgramCatalog();
  return {
    observedAt: Date.now(),
    appReadReady,
    lastError,
    received: rows.map(row => ({ ...row, provenance: [...row.provenance] })),
    realizedRecoveryUsd: Number(realizedUsd.toFixed(8)),
    monthToDateRecoveryUsd: Number(monthToDateUsd.toFixed(8)),
    coinbaseOneObservedThisMonth: monthRows.some(row => row.source === 'coinbase_one_subscription_rebate_received'),
    explicitEurcRebateObservedThisMonth: monthRows.some(row => row.source === 'coinbase_explicit_fee_incentive_received' && row.currency === 'EURC'),
    programCatalog,
    identifiedProgramCount: programCatalog.length,
    officialProgramRateReference: 0.25,
    preferredPublicMonthlyCapUsdReference: 100,
    premiumPublicMonthlyCapUnlimitedReference: true,
    publicProgramTermsAreRuntimeEconomicAuthority: false as const,
    membershipTierInferredFromPublicTerms: false as const,
    remainingMonthlyCapInferred: false as const,
    institutionalEnrollmentInferred: false as const,
    internationalExchangeEligibilityInferred: false as const,
    eeaEligibilityInferred: false as const,
    futureRebatePrecredited: false as const,
    stablecoinParAssumptionAllowed: false as const,
    realizedRecoveryAuthority: 'completed_authenticated_coinbase_app_credit' as const,
    executionAuthority: false as const,
  };
}