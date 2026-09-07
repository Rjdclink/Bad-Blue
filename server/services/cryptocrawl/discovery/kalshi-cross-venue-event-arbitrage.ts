import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import { measureKalshiEventSizedDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import { getKalshiEventSemanticsEvidence } from '../intelligence/kalshi-event-semantics-authority.js';
import type { KalshiPredictionMarketSignal } from '../intelligence/kalshi-prediction-market-authority.js';
import { compareEventSemantics } from './event-venue.js';
import { polymarketEventVenue } from './polymarket-event-venue.js';

export interface EventVenueEquivalenceMapping {
  kalshiTicker: string;
  secondVenue: 'polymarket';
  secondVenueMarketId: string;
  secondVenueConditionId: string;
  reviewedAt: number;
  reviewer: string;
}

export interface CrossVenueEventArbitrageCandidate {
  id: string;
  kalshiTicker: string;
  secondVenue: 'polymarket';
  secondVenueMarketId: string;
  secondVenueConditionId: string;
  matchedContracts: number;
  kalshiOutcome: 'yes' | 'no';
  secondVenueOutcome: 'yes' | 'no';
  kalshiEntryUsd: number | null;
  secondVenueEntryUsd: number | null;
  guaranteedPayoutUsd: number | null;
  kalshiFeeUsd: number | null;
  secondVenueFeeUsd: number | null;
  /** Observable depth slippage already embedded in secondVenueEntryUsd/VWAP; never subtract twice. */
  slippageUsd: number | null;
  settlementCostReserveUsd: number | null;
  capitalLockCostUsd: number | null;
  guaranteedResidualUsd: number | null;
  semanticEquivalenceProven: boolean;
  secondVenueExecutionEvidenceProven: boolean;
  status: 'data_collection' | 'blocked' | 'eligible';
  missingEvidence: string[];
  observedAt: number;
  expiresAt: number;
  executionAuthority: false;
  provenance: string[];
}

let latest: CrossVenueEventArbitrageCandidate[] = [];
let cycles = 0;
let errors = 0;
let lastCompletedAt: number | null = null;

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw); return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}
function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function mappings(): EventVenueEquivalenceMapping[] {
  const raw = process.env.CRYPTOCRAWL_PREDICTION_EQUIVALENCE_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row: any) => {
      const mapping: EventVenueEquivalenceMapping = {
        kalshiTicker: String(row?.kalshiTicker || '').trim().toUpperCase(),
        secondVenue: 'polymarket',
        secondVenueMarketId: String(row?.secondVenueMarketId || '').trim(),
        secondVenueConditionId: String(row?.secondVenueConditionId || '').trim(),
        reviewedAt: Number(row?.reviewedAt),
        reviewer: String(row?.reviewer || '').trim(),
      };
      const complete = mapping.kalshiTicker && mapping.secondVenueMarketId
        && /^0x[0-9a-fA-F]{64}$/.test(mapping.secondVenueConditionId)
        && Number.isFinite(mapping.reviewedAt) && mapping.reviewedAt > 0 && mapping.reviewer;
      return complete ? [mapping] : [];
    });
  } catch { return []; }
}
function mappingFingerprint(mapping: EventVenueEquivalenceMapping): string {
  return sha(JSON.stringify(mapping));
}
function opportunityApr(): number {
  return boundedNumber(process.env.CRYPTOCRAWL_CROSS_EVENT_CAPITAL_OPPORTUNITY_APR, 0, 0, 5);
}
function maxContracts(): number {
  return boundedInt(process.env.CRYPTOCRAWL_CROSS_EVENT_MAX_CONTRACTS, 1_000, 1, 100_000);
}
function secondVenueSettlementCostReserve(): number | null {
  const value = Number(process.env.CRYPTOCRAWL_POLYMARKET_VERIFIED_SETTLEMENT_COST_USD);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function largestMatchedSize(marketId: string, secondOutcome: 'yes' | 'no', cap: number): Promise<number> {
  let low = 1;
  let high = cap;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const quote = await polymarketEventVenue.getSizedQuote(marketId, secondOutcome, 'buy', mid).catch(() => null);
    if (quote?.complete) { best = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return best;
}

export async function refreshKalshiCrossVenueEventArbitrage(signals: KalshiPredictionMarketSignal[]): Promise<CrossVenueEventArbitrageCandidate[]> {
  const now = Date.now();
  const output: CrossVenueEventArbitrageCandidate[] = [];
  try {
    const byTicker = new Map(signals.map(signal => [signal.ticker.trim().toUpperCase(), signal]));
    for (const mapping of mappings()) {
      const signal = byTicker.get(mapping.kalshiTicker);
      if (!signal || signal.expiresAt <= now) continue;

      const [kalshiSemantics, secondMarket, secondAccount] = await Promise.all([
        getKalshiEventSemanticsEvidence(mapping.kalshiTicker, true).catch(() => null),
        polymarketEventVenue.getMarket(mapping.secondVenueMarketId).catch(() => null),
        polymarketEventVenue.getAccountEvidence().catch(() => null),
      ]);
      const conditionMatches = Boolean(
        secondMarket?.conditionId
        && secondMarket.conditionId.toLowerCase() === mapping.secondVenueConditionId.toLowerCase(),
      );
      const equivalence = kalshiSemantics?.complete && kalshiSemantics.semantics && secondMarket?.semantics && conditionMatches
        ? compareEventSemantics(kalshiSemantics.semantics, secondMarket.semantics)
        : null;
      const semanticEquivalenceProven = equivalence?.equivalent === true;

      for (const pair of [
        { kalshi: 'yes' as const, second: 'no' as const },
        { kalshi: 'no' as const, second: 'yes' as const },
      ]) {
        const one = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome: pair.kalshi, side: 'buy', contracts: 1, forceRefresh: true }).catch(() => null);
        if (!one?.complete) continue;
        const secondCap = await largestMatchedSize(mapping.secondVenueMarketId, pair.second, maxContracts());
        if (secondCap < 1) continue;

        let contracts = secondCap;
        let kalshi = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome: pair.kalshi, side: 'buy', contracts, forceRefresh: true }).catch(() => null);
        if (!kalshi?.complete) {
          let low = 1; let high = contracts; let best = 0;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const measured = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome: pair.kalshi, side: 'buy', contracts: mid }).catch(() => null);
            if (measured?.complete) { best = mid; kalshi = measured; low = mid + 1; }
            else high = mid - 1;
          }
          contracts = best;
        }
        if (contracts < 1 || !kalshi?.complete || kalshi.notionalUsd === null || kalshi.vwapPrice === null) continue;
        const [secondQuote, kalshiFee] = await Promise.all([
          polymarketEventVenue.getSizedQuote(mapping.secondVenueMarketId, pair.second, 'buy', contracts).catch(() => null),
          estimateKalshiEventFees({ ticker: signal.ticker, contracts, price: kalshi.vwapPrice, forceRefresh: true }).catch(() => null),
        ]);
        if (!secondQuote?.complete || secondQuote.notionalUsd === null) continue;

        const kalshiFeeUsd = kalshiFee?.economicCreditAllowed && kalshiFee.takerFeeUsd !== null ? kalshiFee.takerFeeUsd : null;
        const secondVenueFeeUsd = secondQuote.feeUsd;
        const secondVenueRequiredCashUsd = secondVenueFeeUsd === null
          ? null
          : secondQuote.notionalUsd + secondVenueFeeUsd;
        const secondVenueExecutionEvidenceProven = Boolean(
          secondAccount?.authenticated
          && secondAccount.accountAccessible
          && secondAccount.orderSubmissionAllowed
          && secondAccount.feeEvidenceAuthenticated
          && secondVenueRequiredCashUsd !== null
          && secondAccount.prefundedSystemOwnedUsd !== null
          && secondAccount.prefundedSystemOwnedUsd + 1e-9 >= secondVenueRequiredCashUsd,
        );
        const settlementCostReserveUsd = secondVenueSettlementCostReserve();
        const deadline = Math.min(
          signal.expiresAt,
          kalshi.expiresAt,
          secondQuote.expiresAt,
          kalshiSemantics?.semantics?.cutoffAt ?? Infinity,
          secondMarket?.semantics.cutoffAt ?? Infinity,
        );
        const principalUsd = kalshi.notionalUsd + secondQuote.notionalUsd;
        const capitalLockCostUsd = Number.isFinite(deadline) && deadline > now
          ? principalUsd * opportunityApr() * ((deadline - now) / (365.25 * 24 * 60 * 60_000))
          : null;
        const slippageUsd = secondQuote.slippageUsd;
        const guaranteedPayoutUsd = semanticEquivalenceProven ? contracts : null;
        const allCostsProven = kalshiFeeUsd !== null && secondVenueFeeUsd !== null && slippageUsd !== null
          && settlementCostReserveUsd !== null && capitalLockCostUsd !== null;
        // Both leg notionals are exact depth-weighted VWAP and already embed
        // order-book slippage. slippageUsd remains attribution/telemetry only.
        const guaranteedResidualUsd = guaranteedPayoutUsd !== null && allCostsProven && secondVenueExecutionEvidenceProven
          ? guaranteedPayoutUsd - kalshi.notionalUsd - secondQuote.notionalUsd - kalshiFeeUsd! - secondVenueFeeUsd!
            - settlementCostReserveUsd! - capitalLockCostUsd!
          : null;
        const missingEvidence = [
          ...(kalshiSemantics?.complete ? [] : kalshiSemantics?.missing ?? ['required:kalshi_exact_semantics']),
          ...(secondMarket ? [] : ['required:second_venue_exact_semantics']),
          ...(conditionMatches ? [] : ['required:second_venue_condition_identity']),
          ...(semanticEquivalenceProven ? [] : [
            'required:exact_semantic_equivalence_question_rules_outcomes_source_deadline_timezone_resolution_void_cancel_payout_settlement',
          ]),
          ...(kalshiFeeUsd !== null ? [] : ['required:kalshi_authenticated_fee']),
          ...(secondQuote.feeUsd !== null ? [] : ['required:second_venue_market_fee_schedule']),
          ...(secondVenueExecutionEvidenceProven ? [] : ['required:authenticated_second_venue_account_fee_execution_and_system_owned_prefunding']),
          ...(settlementCostReserveUsd !== null ? [] : ['required:verified_second_venue_settlement_cost']),
          ...(capitalLockCostUsd !== null ? [] : ['required:capital_lock_opportunity_cost']),
          ...(guaranteedResidualUsd !== null && guaranteedResidualUsd > 0 ? [] : ['required:positive_guaranteed_residual_after_every_cost']),
        ];
        const status: CrossVenueEventArbitrageCandidate['status'] = missingEvidence.length === 0 ? 'eligible' : 'data_collection';
        output.push({
          id: `kalshi-cross-event:${sha(`${signal.ticker}|${mappingFingerprint(mapping)}|${pair.kalshi}|${contracts}`).slice(0, 44)}`,
          kalshiTicker: signal.ticker,
          secondVenue: 'polymarket',
          secondVenueMarketId: mapping.secondVenueMarketId,
          secondVenueConditionId: mapping.secondVenueConditionId,
          matchedContracts: contracts,
          kalshiOutcome: pair.kalshi,
          secondVenueOutcome: pair.second,
          kalshiEntryUsd: kalshi.notionalUsd,
          secondVenueEntryUsd: secondQuote.notionalUsd,
          guaranteedPayoutUsd,
          kalshiFeeUsd,
          secondVenueFeeUsd,
          slippageUsd,
          settlementCostReserveUsd,
          capitalLockCostUsd,
          guaranteedResidualUsd,
          semanticEquivalenceProven,
          secondVenueExecutionEvidenceProven,
          status,
          missingEvidence: [...new Set(missingEvidence)],
          observedAt: Math.max(kalshi.observedAt, secondQuote.observedAt, kalshiSemantics?.observedAt ?? 0, secondMarket?.observedAt ?? 0),
          expiresAt: Number.isFinite(deadline) ? deadline : Math.min(signal.expiresAt, kalshi.expiresAt, secondQuote.expiresAt),
          executionAuthority: false,
          provenance: [
            ...signal.provenance,
            ...kalshi.provenance,
            ...secondQuote.provenance,
            ...(kalshiSemantics?.provenance ?? []),
            ...(secondMarket?.provenance ?? []),
            `second_venue_condition_id:${mapping.secondVenueConditionId}`,
            `condition_id:${mapping.secondVenueConditionId}`,
            `semantic_equivalence_mapping:${mappingFingerprint(mapping)}`,
            `mapping_reviewer:${mapping.reviewer}`,
            ...(equivalence ? [`semantic_mismatches:${equivalence.mismatches.join(',') || 'none'}`] : ['semantic_comparison:incomplete']),
            'cross_venue_semantics:independently_derived_not_mapping_asserted',
            'cross_venue_complementary_payout:only_after_exact_semantic_equivalence',
            'depth_vwap_notional:slippage_embedded_exactly_once',
            'non_atomic_legging:kalshi_fok_then_polymarket_fok',
            'one_leg_failure:kalshi_reduce_only_fok_recovery_durable',
            'terminal_reconciliation:canonical_lifecycle_implemented',
            'second_venue_account_balance_mints_system_ownership:false',
            'discovery_execution_authority:false',
            'canonical_scheduler_lifecycle_execution_authority:required',
          ],
        });
      }
    }
    cycles += 1;
    lastCompletedAt = Date.now();
    latest = output;
  } catch (error) {
    errors += 1;
    latest = [];
    logger.warn('[KalshiCrossVenue] Cross-venue event arbitrage scan failed closed', {
      component: 'KalshiCrossVenueEventArbitrage', error: error instanceof Error ? error.message : String(error),
      staleCandidatesRetained: false, executionAuthority: false,
    });
  }
  return latest.map(row => ({ ...row, missingEvidence: [...row.missingEvidence], provenance: [...row.provenance] }));
}

export function getKalshiCrossVenueEventArbitrageSnapshot() {
  return {
    cycles,
    errors,
    lastCompletedAt,
    candidates: latest.map(row => ({ ...row, missingEvidence: [...row.missingEvidence], provenance: [...row.provenance] })),
    exactSemanticEquivalenceRequired: true as const,
    matchedExecutableDepthRequired: true as const,
    settlementAndCapitalLockCostsRequired: true as const,
    nonAtomicLegRecoveryRequired: true as const,
    secondVenueAuthenticatedExecutionEvidenceRequired: true as const,
    crossVenueSystemOwnedPrefundingRequired: true as const,
    durableTerminalReconciliationImplemented: true as const,
    executionAuthority: false as const,
  };
}
