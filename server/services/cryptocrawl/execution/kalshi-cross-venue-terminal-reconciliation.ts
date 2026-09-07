import logger from '../../../logger.js';
import { polymarketEventVenue } from '../discovery/polymarket-event-venue.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { applyKalshiEventTerminalCashSettlement, releaseKalshiEventSystemCashReservation } from './kalshi-event-system-owned-cash-ledger.js';
import { getKalshiEventSettlement } from './kalshi-event-order-authority.js';
import { realizePolymarketEventSettlement } from './polymarket-event-settlement-authority.js';
import { applyPolymarketTerminalCashSettlement, releasePolymarketSystemCashReservation } from './polymarket-system-owned-cash-ledger.js';

const TABLE = 'private.cryptocrawler_cross_venue_event_lifecycles';

type Outcome = 'yes' | 'no';

type EntryReceipt = {
  orderId: string;
  contracts: number;
  averageOutcomePrice: number;
  entryCostUsd: number;
  feeUsd: number;
  observedAt: number;
};

type Stored = {
  lifecycleId: string;
  opportunityId: string;
  kalshiTicker: string;
  polymarketMarketId: string;
  polymarketConditionId: string;
  matchedContracts: number;
  kalshiOutcome: Outcome;
  polymarketOutcome: Outcome;
  status: string;
  kalshiCashReservationId: string | null;
  polymarketCashReservationId: string | null;
  kalshiOrderId: string | null;
  polymarketOrderId: string | null;
  kalshiEntry: EntryReceipt | null;
  polymarketEntry: EntryReceipt | null;
};

export interface CrossVenueTerminalReconciliationResult {
  lifecycleId: string;
  opportunityId: string;
  terminal: boolean;
  status: 'waiting' | 'settled' | 'quarantined';
  commonResult?: Outcome;
  kalshiNetCashDeltaUsd?: number;
  polymarketNetCashDeltaUsd?: number;
  combinedVenueCashProfitUsd?: number;
  polymarketRedemptionGasWei?: bigint;
  error?: string;
}

function parseJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return null; }
}
function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('CROSS_EVENT_TERMINAL_NON_FINITE_DECIMAL');
  return value.toFixed(12).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function tolerance(value: number): number { return Math.max(1e-8, Math.abs(value) * 1e-8); }
function parseStored(row: any): Stored | null {
  const contracts = Number(row?.matched_contracts);
  const kalshiEntry = parseJson<EntryReceipt>(row?.kalshi_entry_receipt);
  const polymarketEntry = parseJson<EntryReceipt>(row?.polymarket_entry_receipt);
  if (!row?.lifecycle_id || !row?.opportunity_id || !Number.isInteger(contracts) || contracts <= 0) return null;
  return {
    lifecycleId: String(row.lifecycle_id),
    opportunityId: String(row.opportunity_id),
    kalshiTicker: String(row.kalshi_ticker),
    polymarketMarketId: String(row.polymarket_market_id),
    polymarketConditionId: String(row.polymarket_condition_id),
    matchedContracts: contracts,
    kalshiOutcome: String(row.kalshi_outcome) as Outcome,
    polymarketOutcome: String(row.polymarket_outcome) as Outcome,
    status: String(row.status),
    kalshiCashReservationId: row.kalshi_cash_reservation_id ? String(row.kalshi_cash_reservation_id) : null,
    polymarketCashReservationId: row.polymarket_cash_reservation_id ? String(row.polymarket_cash_reservation_id) : null,
    kalshiOrderId: row.kalshi_order_id ? String(row.kalshi_order_id) : null,
    polymarketOrderId: row.polymarket_order_id ? String(row.polymarket_order_id) : null,
    kalshiEntry,
    polymarketEntry,
  };
}
async function persist(input: { lifecycleId: string; status: 'HEDGED_WAITING_SETTLEMENT' | 'SETTLED' | 'QUARANTINED'; terminalSettlement?: Record<string, unknown>; error?: string | null }): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE}
     SET status=$2,
         terminal_settlement=CASE WHEN $3::jsonb IS NULL THEN terminal_settlement ELSE $3::jsonb END,
         last_error=$4,
         terminal_at=CASE WHEN $2 IN ('SETTLED','QUARANTINED') THEN COALESCE(terminal_at,now()) ELSE terminal_at END,
         updated_at=now()
     WHERE lifecycle_id=$1`,
    [input.lifecycleId, input.status, input.terminalSettlement ? JSON.stringify(input.terminalSettlement) : null, input.error ?? null],
  );
}
function validateEntry(label: string, receipt: EntryReceipt | null, contracts: number): EntryReceipt {
  if (!receipt || !receipt.orderId || receipt.contracts !== contracts) throw new Error(`${label}_ENTRY_RECEIPT_MISSING_OR_MISMATCH`);
  for (const [name, value] of Object.entries({ entryCostUsd: receipt.entryCostUsd, feeUsd: receipt.feeUsd, averageOutcomePrice: receipt.averageOutcomePrice })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label}_${name.toUpperCase()}_INVALID`);
  }
  if (!(receipt.averageOutcomePrice > 0) || !(receipt.averageOutcomePrice < 1)) throw new Error(`${label}_AVERAGE_PRICE_INVALID`);
  return receipt;
}
function kalshiSettlementFeeForLifecycle(input: {
  outcome: Outcome;
  contracts: number;
  settlementFeeUsd: number;
  yesCount: number;
  noCount: number;
}): number {
  if (!Number.isFinite(input.settlementFeeUsd) || input.settlementFeeUsd < 0) throw new Error('CROSS_EVENT_KALSHI_SETTLEMENT_FEE_INVALID');
  if (input.settlementFeeUsd === 0) return 0;
  const isolated = input.outcome === 'yes'
    ? Math.abs(input.yesCount - input.contracts) <= tolerance(input.contracts) && Math.abs(input.noCount) <= 1e-8
    : Math.abs(input.noCount - input.contracts) <= tolerance(input.contracts) && Math.abs(input.yesCount) <= 1e-8;
  if (!isolated) throw new Error('CROSS_EVENT_KALSHI_SETTLEMENT_FEE_NOT_LIFECYCLE_ATTRIBUTABLE');
  return input.settlementFeeUsd;
}

async function loadOne(lifecycleId: string): Promise<Stored | null> {
  const query = await pool.query(`SELECT * FROM ${TABLE} WHERE lifecycle_id=$1`, [lifecycleId]);
  return parseStored(query.rows?.[0]);
}

export async function reconcileKalshiCrossVenueTerminalSettlement(lifecycleId: string): Promise<CrossVenueTerminalReconciliationResult> {
  const stored = await loadOne(lifecycleId);
  if (!stored) throw new Error('CROSS_EVENT_TERMINAL_LIFECYCLE_NOT_FOUND');
  if (stored.status === 'SETTLED') return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: true, status: 'settled' };
  if (stored.status === 'QUARANTINED') return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: true, status: 'quarantined', error: 'CROSS_EVENT_ALREADY_QUARANTINED' };
  if (stored.status !== 'HEDGED_WAITING_SETTLEMENT') return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: false, status: 'waiting', error: `CROSS_EVENT_NOT_HEDGED:${stored.status}` };

  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(stored.polymarketConditionId)) throw new Error('CROSS_EVENT_DURABLE_CONDITION_ID_INVALID');
    if (!stored.kalshiOrderId || !stored.polymarketOrderId || !stored.kalshiCashReservationId || !stored.polymarketCashReservationId) {
      throw new Error('CROSS_EVENT_TERMINAL_DURABLE_AUTHORITY_INCOMPLETE');
    }
    const kalshiEntry = validateEntry('KALSHI', stored.kalshiEntry, stored.matchedContracts);
    const polymarketEntry = validateEntry('POLYMARKET', stored.polymarketEntry, stored.matchedContracts);

    const [kalshiSettlement, polymarketSettlement] = await Promise.all([
      getKalshiEventSettlement(stored.kalshiTicker).catch(() => null),
      polymarketEventVenue.getSettlement(stored.polymarketMarketId).catch(() => null),
    ]);
    if (!kalshiSettlement || !polymarketSettlement?.terminal) {
      return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: false, status: 'waiting', error: 'CROSS_EVENT_TERMINAL_RESOLUTION_PENDING' };
    }
    const kalshiResult = String(kalshiSettlement.marketResult || '').trim().toLowerCase();
    const polymarketResult = polymarketSettlement.result;
    if ((kalshiResult !== 'yes' && kalshiResult !== 'no') || (polymarketResult !== 'yes' && polymarketResult !== 'no')) {
      await persist({
        lifecycleId: stored.lifecycleId, status: 'QUARANTINED', error: 'CROSS_EVENT_EXCEPTIONAL_SETTLEMENT_REQUIRES_RECONCILIATION',
        terminalSettlement: { kalshiSettlement, polymarketSettlement, accountingApplied: false, reservationsReleased: false },
      });
      return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: true, status: 'quarantined', error: 'CROSS_EVENT_EXCEPTIONAL_SETTLEMENT_REQUIRES_RECONCILIATION' };
    }
    if (kalshiResult !== polymarketResult) {
      await persist({
        lifecycleId: stored.lifecycleId, status: 'QUARANTINED', error: 'CROSS_EVENT_EQUIVALENT_MARKETS_RESOLVED_DIFFERENTLY',
        terminalSettlement: { kalshiSettlement, polymarketSettlement, accountingApplied: false, reservationsReleased: false },
      });
      return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: true, status: 'quarantined', error: 'CROSS_EVENT_EQUIVALENT_MARKETS_RESOLVED_DIFFERENTLY' };
    }
    if (stored.kalshiOutcome === stored.polymarketOutcome) throw new Error('CROSS_EVENT_PURCHASED_OUTCOMES_NOT_COMPLEMENTARY');

    const commonResult = kalshiResult as Outcome;
    const polymarketRedemption = await realizePolymarketEventSettlement({
      lifecycleId: stored.lifecycleId,
      opportunityId: stored.opportunityId,
      polymarketOrderId: stored.polymarketOrderId,
      marketId: stored.polymarketMarketId,
      conditionId: stored.polymarketConditionId,
      outcome: stored.polymarketOutcome,
      marketResult: commonResult,
      contracts: stored.matchedContracts,
    });
    if (!polymarketRedemption.terminal || !polymarketRedemption.cashRealized || polymarketRedemption.payoutUsd === null) {
      await persist({
        lifecycleId: stored.lifecycleId,
        status: 'HEDGED_WAITING_SETTLEMENT',
        error: polymarketRedemption.error ?? 'POLYMARKET_TERMINAL_CASH_REALIZATION_PENDING',
        terminalSettlement: { kalshiSettlement, polymarketSettlement, polymarketRedemption, accountingApplied: false, reservationsReleased: false },
      });
      return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: false, status: 'waiting', commonResult, polymarketRedemptionGasWei: polymarketRedemption.gasSpentWei, error: polymarketRedemption.error ?? 'POLYMARKET_TERMINAL_CASH_REALIZATION_PENDING' };
    }

    const kalshiSettlementFeeUsd = kalshiSettlementFeeForLifecycle({
      outcome: stored.kalshiOutcome,
      contracts: stored.matchedContracts,
      settlementFeeUsd: kalshiSettlement.settlementFeeUsd,
      yesCount: kalshiSettlement.yesCount,
      noCount: kalshiSettlement.noCount,
    });
    const kalshiPayoutUsd = commonResult === stored.kalshiOutcome ? stored.matchedContracts : 0;
    const polymarketPayoutUsd = polymarketRedemption.payoutUsd;
    const expectedPolymarketPayout = commonResult === stored.polymarketOutcome ? stored.matchedContracts : 0;
    if (Math.abs(polymarketPayoutUsd - expectedPolymarketPayout) > tolerance(Math.max(1, expectedPolymarketPayout))) {
      throw new Error(`CROSS_EVENT_POLYMARKET_REALIZED_PAYOUT_MISMATCH:${polymarketPayoutUsd}:${expectedPolymarketPayout}`);
    }
    if (Math.abs(kalshiPayoutUsd + polymarketPayoutUsd - stored.matchedContracts) > tolerance(stored.matchedContracts)) {
      throw new Error('CROSS_EVENT_COMPLEMENTARY_PAYOUT_INVARIANT_BREACH');
    }

    const kalshiNet = kalshiPayoutUsd - kalshiEntry.entryCostUsd - kalshiEntry.feeUsd - kalshiSettlementFeeUsd;
    const polymarketNet = polymarketPayoutUsd - polymarketEntry.entryCostUsd - polymarketEntry.feeUsd;
    const combinedVenueCashProfitUsd = kalshiNet + polymarketNet;

    // Each venue ledger applies only that venue's exact terminal cash delta. This
    // preserves ownership and prevents a winning leg from minting gross proceeds.
    // Native redemption gas remains in the canonical system-native gas ledger and
    // is carried as exact wei evidence here for later single-path BPS/profit valuation.
    await applyKalshiEventTerminalCashSettlement({
      settlementReference: `cross-event:kalshi:${stored.lifecycleId}`,
      lifecycleId: stored.lifecycleId,
      opportunityId: stored.opportunityId,
      strategy: 'kalshi_polymarket_cross_event_arbitrage',
      cashDeltaUsd: decimal(kalshiNet),
      realizedStrategyProfitUsd: decimal(kalshiNet),
      realizedFeesUsd: decimal(kalshiEntry.feeUsd + kalshiSettlementFeeUsd),
      realizedIncentiveUsd: '0',
      settlementEvidence: {
        venue: 'kalshi', ticker: stored.kalshiTicker, marketResult: commonResult,
        outcome: stored.kalshiOutcome, contracts: stored.matchedContracts,
        payoutUsd: kalshiPayoutUsd, entryCostUsd: kalshiEntry.entryCostUsd,
        entryFeeUsd: kalshiEntry.feeUsd, settlementFeeUsd: kalshiSettlementFeeUsd,
        authenticatedSettlementObservedAt: kalshiSettlement.observedAt,
      },
      authorityEvidence: {
        crossVenueLifecycleId: stored.lifecycleId,
        systemOwnedCashReservationId: stored.kalshiCashReservationId,
        complementaryPayoutInvariant: true,
        grossSettlementProceedsMintOwnership: false,
        personalCapitalUsed: false,
      },
    });
    await applyPolymarketTerminalCashSettlement({
      settlementReference: `cross-event:polymarket:${stored.lifecycleId}`,
      lifecycleId: stored.lifecycleId,
      opportunityId: stored.opportunityId,
      strategy: 'kalshi_polymarket_cross_event_arbitrage',
      cashDeltaUsd: decimal(polymarketNet),
      realizedStrategyProfitUsd: decimal(polymarketNet),
      realizedFeesUsd: decimal(polymarketEntry.feeUsd),
      realizedIncentiveUsd: '0',
      settlementEvidence: {
        venue: 'polymarket', marketId: stored.polymarketMarketId, conditionId: stored.polymarketConditionId,
        marketResult: commonResult, outcome: stored.polymarketOutcome, contracts: stored.matchedContracts,
        payoutUsd: polymarketPayoutUsd, entryCostUsd: polymarketEntry.entryCostUsd,
        entryFeeUsd: polymarketEntry.feeUsd, redemptionTransactionHash: polymarketRedemption.transactionHash,
        redemptionGasWei: polymarketRedemption.gasSpentWei.toString(),
        redemptionProvenance: polymarketRedemption.provenance,
      },
      authorityEvidence: {
        crossVenueLifecycleId: stored.lifecycleId,
        systemOwnedCashReservationId: stored.polymarketCashReservationId,
        exactPusdBalanceDelta: true,
        systemOwnedNativeGasLedgerOwnsRedemptionGasCost: true,
        accountBalanceMintsOwnership: false,
        personalCapitalUsed: false,
      },
    });

    await releaseKalshiEventSystemCashReservation(stored.kalshiCashReservationId);
    await releasePolymarketSystemCashReservation(stored.polymarketCashReservationId);
    const terminalEvidence = {
      commonResult,
      matchedContracts: stored.matchedContracts,
      kalshi: { payoutUsd: kalshiPayoutUsd, netCashDeltaUsd: kalshiNet, entry: kalshiEntry, settlementFeeUsd: kalshiSettlementFeeUsd },
      polymarket: { payoutUsd: polymarketPayoutUsd, netCashDeltaUsd: polymarketNet, entry: polymarketEntry, redemption: polymarketRedemption },
      combinedVenueCashProfitUsd,
      polymarketRedemptionGasWei: polymarketRedemption.gasSpentWei.toString(),
      nativeGasUsdCreditedHere: false,
      canonicalNativeGasLedgerOwnsGasAccounting: true,
      complementaryPayoutInvariant: true,
      accountingAppliedExactlyOnceBySettlementReference: true,
      reservationsReleasedAfterBothVenueCashSettlements: true,
      grossSettlementProceedsMintOwnership: false,
      realizedBpsAuthority: false,
    };
    await persist({ lifecycleId: stored.lifecycleId, status: 'SETTLED', terminalSettlement: terminalEvidence, error: null });
    return {
      lifecycleId: stored.lifecycleId,
      opportunityId: stored.opportunityId,
      terminal: true,
      status: 'settled',
      commonResult,
      kalshiNetCashDeltaUsd: kalshiNet,
      polymarketNetCashDeltaUsd: polymarketNet,
      combinedVenueCashProfitUsd,
      polymarketRedemptionGasWei: polymarketRedemption.gasSpentWei,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[CrossVenueEventTerminal] Terminal reconciliation failed closed', {
      component: 'KalshiCrossVenueTerminalReconciliation', lifecycleId: stored.lifecycleId,
      opportunityId: stored.opportunityId, error: message,
      reservationsReleased: false, realizedBpsAuthority: false, personalCapitalFallback: false,
    });
    await persist({ lifecycleId: stored.lifecycleId, status: 'QUARANTINED', error: message, terminalSettlement: { accountingComplete: false, reservationsReleased: false, error: message } }).catch(() => undefined);
    return { lifecycleId: stored.lifecycleId, opportunityId: stored.opportunityId, terminal: true, status: 'quarantined', error: message };
  }
}

export async function reconcileKalshiCrossVenueTerminalSettlements(limit = 8): Promise<CrossVenueTerminalReconciliationResult[]> {
  const capped = Math.max(1, Math.min(64, Math.trunc(limit)));
  const query = await pool.query(
    `SELECT lifecycle_id FROM ${TABLE} WHERE status='HEDGED_WAITING_SETTLEMENT' ORDER BY updated_at ASC LIMIT $1`,
    [capped],
  );
  const output: CrossVenueTerminalReconciliationResult[] = [];
  for (const row of query.rows) {
    output.push(await reconcileKalshiCrossVenueTerminalSettlement(String(row.lifecycle_id)));
  }
  return output;
}
