import logger from '../../../logger.js';
import { krakenPrivateRequest, okxPrivateRequest } from './cex-private-authority.js';

export type CexFeeRecoveryVenue = 'coinbase' | 'kraken' | 'okx';
export type CexFeeRecoveryMode =
  | 'embedded_authenticated_fee_surface'
  | 'available_fee_credit'
  | 'received_only'
  | 'external_or_manual_only'
  | 'excluded_for_proprietary_trading';

export interface CexFeeRecoveryProgramCatalogRow {
  key: string;
  venue: CexFeeRecoveryVenue;
  mode: CexFeeRecoveryMode;
  preTradeEconomicAuthority: boolean;
  newApiKeyRequired: boolean;
  automaticallyObserved: boolean;
  note: string;
}

export interface KrakenKfeeSnapshot {
  venue: 'kraken';
  source: 'kraken_authenticated_balance';
  creditCode: 'KFEE' | 'FEE' | null;
  creditUnits: number;
  availableFeeOffsetUsd: number;
  observedAt: number;
  autoAppliedByVenue: true;
  preTradeEconomicAuthority: false;
  reasonPreTradeAuthorityFalse: 'available_credit_not_cross_replica_reserved';
}

export interface ReceivedCexFeeRecovery {
  venue: 'okx';
  source: 'okx_rebate_card_received' | 'okx_affiliate_fee_rebate_received';
  externalId: string;
  currency: 'USD' | 'USDT' | 'USDC';
  amount: number;
  amountUsd: number | null;
  requiresUsdNormalization: boolean;
  observedAt: number;
  received: true;
  preTradeEconomicAuthority: false;
  realizedRecoveryAuthority: true;
}

function boundedEnvInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

const REFRESH_MS = boundedEnvInteger('CRYPTOCRAWL_CEX_FEE_RECOVERY_REFRESH_MS', 60_000, 15_000, 15 * 60_000);
const PRIVATE_TIMEOUT_MS = boundedEnvInteger('CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS', 8_000, 3_000, 15_000);
const MAX_RECEIVED_ROWS = boundedEnvInteger('CRYPTOCRAWL_CEX_FEE_RECOVERY_ROWS', 1_000, 100, 5_000);

let krakenKfee: KrakenKfeeSnapshot | null = null;
let krakenRefreshAt = 0;
let krakenInFlight: Promise<KrakenKfeeSnapshot> | null = null;
let okxRefreshAt = 0;
let okxInFlight: Promise<ReceivedCexFeeRecovery[]> | null = null;
const received = new Map<string, ReceivedCexFeeRecovery>();

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function trimReceivedRows(): void {
  if (received.size <= MAX_RECEIVED_ROWS) return;
  const rows = [...received.entries()].sort((left, right) => left[1].observedAt - right[1].observedAt);
  for (const [key] of rows.slice(0, rows.length - MAX_RECEIVED_ROWS)) received.delete(key);
}

export function getCexFeeRecoveryProgramCatalog(): CexFeeRecoveryProgramCatalogRow[] {
  return [
    {
      key: 'coinbase_stablepair_zero_maker',
      venue: 'coinbase',
      mode: 'embedded_authenticated_fee_surface',
      preTradeEconomicAuthority: true,
      newApiKeyRequired: false,
      automaticallyObserved: true,
      note: 'Exact live fx_stablecoin product classification can reduce Coinbase maker fee to zero before execution.',
    },
    {
      key: 'coinbase_fee_tier_liquidity_or_match',
      venue: 'coinbase',
      mode: 'embedded_authenticated_fee_surface',
      preTradeEconomicAuthority: true,
      newApiKeyRequired: false,
      automaticallyObserved: true,
      note: 'Any approved fee-tier, liquidity-program, or fee-match improvement is consumed only after it appears in authenticated transaction-summary rates.',
    },
    {
      key: 'coinbase_one_advanced_fee_rebate',
      venue: 'coinbase',
      mode: 'received_only',
      preTradeEconomicAuthority: false,
      newApiKeyRequired: false,
      automaticallyObserved: false,
      note: 'Coinbase One Advanced rebates are not pre-credited because the current trading API does not prove membership, cap remainder, or a received USDC rebate.',
    },
    {
      key: 'kraken_pair_zero_or_negative_maker',
      venue: 'kraken',
      mode: 'embedded_authenticated_fee_surface',
      preTradeEconomicAuthority: true,
      newApiKeyRequired: false,
      automaticallyObserved: true,
      note: 'Kraken TradeVolume pair evidence already preserves zero maker fees and negative maker rebates in canonical fee economics.',
    },
    {
      key: 'kraken_kfee',
      venue: 'kraken',
      mode: 'available_fee_credit',
      preTradeEconomicAuthority: false,
      newApiKeyRequired: false,
      automaticallyObserved: true,
      note: 'Authenticated KFEE/FEE balance is measured and the venue auto-applies it, but it is not pre-credited until a cross-replica reservation/terminal deduction can be proven.',
    },
    {
      key: 'okx_zero_or_negative_fee_surface',
      venue: 'okx',
      mode: 'embedded_authenticated_fee_surface',
      preTradeEconomicAuthority: true,
      newApiKeyRequired: false,
      automaticallyObserved: true,
      note: 'Authenticated OKX trade-fee evidence plus the live zero-fee product group remains the executable fee authority.',
    },
    {
      key: 'okx_rebate_card',
      venue: 'okx',
      mode: 'received_only',
      preTradeEconomicAuthority: false,
      newApiKeyRequired: false,
      automaticallyObserved: true,
      note: 'Only received funding-account bill type 68 credits are admitted as realized fee recovery; card face value or future reimbursement is never pre-credited.',
    },
    {
      key: 'okx_tradeback_voucher',
      venue: 'okx',
      mode: 'received_only',
      preTradeEconomicAuthority: false,
      newApiKeyRequired: false,
      automaticallyObserved: false,
      note: 'Voucher availability and future tradeback are not economic truth without distinct authenticated received-credit provenance.',
    },
    {
      key: 'okx_ai_builder_proprietary_trade_commission',
      venue: 'okx',
      mode: 'excluded_for_proprietary_trading',
      preTradeEconomicAuthority: false,
      newApiKeyRequired: false,
      automaticallyObserved: false,
      note: 'Builder commissions are not credited to CryptoCrawler proprietary trades.',
    },
    {
      key: 'third_party_cashback',
      venue: 'okx',
      mode: 'external_or_manual_only',
      preTradeEconomicAuthority: false,
      newApiKeyRequired: false,
      automaticallyObserved: false,
      note: 'External cashback/referral attribution is excluded from executable economics unless an actual received credit can be independently proven without account rebinding or a new trading key.',
    },
  ];
}

export async function refreshKrakenKfeeSnapshot(force = false): Promise<KrakenKfeeSnapshot> {
  const now = Date.now();
  if (!force && krakenKfee && krakenRefreshAt + REFRESH_MS > now) return { ...krakenKfee };
  if (krakenInFlight) return { ...(await krakenInFlight) };

  krakenInFlight = (async () => {
    const balances = await krakenPrivateRequest('/0/private/Balance', {}, { timeoutMs: PRIVATE_TIMEOUT_MS });
    const kfee = finiteNonNegative(balances?.KFEE);
    const fee = finiteNonNegative(balances?.FEE);
    // Kraken documentation treats KFEE/FEE as aliases. Never sum both aliases;
    // taking the larger visible value avoids double counting if both are emitted.
    const creditUnits = Math.max(kfee ?? 0, fee ?? 0);
    const creditCode: 'KFEE' | 'FEE' | null = kfee !== null && kfee >= (fee ?? -1)
      ? 'KFEE'
      : fee !== null ? 'FEE' : null;
    const value: KrakenKfeeSnapshot = {
      venue: 'kraken',
      source: 'kraken_authenticated_balance',
      creditCode,
      creditUnits,
      availableFeeOffsetUsd: Number((creditUnits * 0.01).toFixed(8)),
      observedAt: Date.now(),
      autoAppliedByVenue: true,
      preTradeEconomicAuthority: false,
      reasonPreTradeAuthorityFalse: 'available_credit_not_cross_replica_reserved',
    };
    krakenKfee = value;
    krakenRefreshAt = value.observedAt;
    return value;
  })().finally(() => { krakenInFlight = null; });

  return { ...(await krakenInFlight) };
}

function parseOkxReceivedRows(
  rows: any[],
  source: ReceivedCexFeeRecovery['source'],
): ReceivedCexFeeRecovery[] {
  const parsed: ReceivedCexFeeRecovery[] = [];
  for (const row of rows) {
    const currency = String(row?.ccy ?? '').trim().toUpperCase();
    if (currency !== 'USD' && currency !== 'USDT' && currency !== 'USDC') continue;
    const amount = finitePositive(row?.balChg);
    if (amount === null) continue;
    const observedAt = finitePositive(row?.ts) ?? Date.now();
    const externalId = String(row?.billId ?? '').trim();
    if (!externalId) continue;
    parsed.push({
      venue: 'okx',
      source,
      externalId,
      currency: currency as 'USD' | 'USDT' | 'USDC',
      amount,
      amountUsd: currency === 'USD' ? amount : null,
      requiresUsdNormalization: currency !== 'USD',
      observedAt,
      received: true,
      preTradeEconomicAuthority: false,
      realizedRecoveryAuthority: true,
    });
  }
  return parsed;
}

export async function refreshOkxReceivedFeeRecoveries(force = false): Promise<ReceivedCexFeeRecovery[]> {
  const now = Date.now();
  if (!force && okxRefreshAt + REFRESH_MS > now) return [...received.values()].map(row => ({ ...row }));
  if (okxInFlight) return (await okxInFlight).map(row => ({ ...row }));

  okxInFlight = (async () => {
    const requests = await Promise.allSettled([
      okxPrivateRequest('/api/v5/asset/bills', 'GET', { type: '68', limit: '100' }, { timeoutMs: PRIVATE_TIMEOUT_MS, lane: 'account_read' }),
      okxPrivateRequest('/api/v5/asset/bills', 'GET', { type: '173', limit: '100' }, { timeoutMs: PRIVATE_TIMEOUT_MS, lane: 'account_read' }),
    ]);
    const cardRows = requests[0].status === 'fulfilled'
      ? parseOkxReceivedRows(requests[0].value.data, 'okx_rebate_card_received')
      : [];
    const feeRebateRows = requests[1].status === 'fulfilled'
      ? parseOkxReceivedRows(requests[1].value.data, 'okx_affiliate_fee_rebate_received')
      : [];
    for (const row of [...cardRows, ...feeRebateRows]) received.set(`${row.source}:${row.externalId}`, row);
    trimReceivedRows();
    okxRefreshAt = Date.now();

    const failures = requests.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length > 0) {
      logger.debug('[CEX Fee Recovery] One or more OKX received-credit reads were unavailable', {
        component: 'CexFeeRecoveryAuthority',
        failedReads: failures.length,
        receivedRowsRetained: received.size,
        futureCreditPrecredited: false,
        executionAuthority: false,
      });
    }
    return [...received.values()];
  })().finally(() => { okxInFlight = null; });

  return (await okxInFlight).map(row => ({ ...row }));
}

export async function refreshCexFeeRecoveryEvidence(force = false): Promise<void> {
  const outcomes = await Promise.allSettled([
    refreshKrakenKfeeSnapshot(force),
    refreshOkxReceivedFeeRecoveries(force),
  ]);
  const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length === outcomes.length) {
    throw new Error(`No CEX fee-recovery evidence source refreshed: ${failures.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join(' | ')}`);
  }
}

export function getCexFeeRecoverySnapshot() {
  const receivedRows = [...received.values()].sort((left, right) => right.observedAt - left.observedAt);
  const receivedRecoveryUsd = receivedRows.reduce((sum, row) => sum + (row.amountUsd ?? 0), 0);
  return {
    observedAt: Date.now(),
    krakenKfee: krakenKfee ? { ...krakenKfee } : null,
    received: receivedRows.map(row => ({ ...row })),
    receivedRecoveryUsd: Number(receivedRecoveryUsd.toFixed(8)),
    receivedRowsRequiringUsdNormalization: receivedRows.filter(row => row.requiresUsdNormalization).length,
    programCatalog: getCexFeeRecoveryProgramCatalog(),
    canonicalEmbeddedFeeAuthority: 'cex_fee_resolver' as const,
    realizedRecoveryAuthority: 'received_authenticated_credits_only' as const,
    stablecoinParAssumptionAllowed: false as const,
    unreceivedForecastCreditBps: 0 as const,
    futureOrConfiguredRecoveryCanCreateProfitability: false as const,
    crossReplicaKfeeReservationImplemented: false as const,
    preTradeKfeeCreditAllowed: false as const,
    executionAuthority: false as const,
  };
}
