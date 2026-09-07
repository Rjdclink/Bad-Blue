import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import { measureKalshiEventSizedDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import type { KalshiPredictionMarketSignal } from '../intelligence/kalshi-prediction-market-authority.js';

export interface EventVenueEquivalenceMapping {
  kalshiTicker: string;
  secondVenue: 'polymarket';
  secondVenueMarketId: string;
  secondVenueConditionId: string;
  resolutionCriteriaFingerprint: string;
  settlementSourceFingerprint: string;
  cutoffAt: number;
  timezone: string;
  voidTreatmentFingerprint: string;
  payoutDefinitionFingerprint: string;
  settlementTimingFingerprint: string;
  reviewedAt: number;
  reviewer: string;
}

export interface CrossVenueEventArbitrageCandidate {
  id: string;
  kalshiTicker: string;
  secondVenue: 'polymarket';
  secondVenueMarketId: string;
  matchedContracts: number;
  kalshiOutcome: 'yes' | 'no';
  secondVenueOutcome: 'yes' | 'no';
  kalshiEntryUsd: number | null;
  secondVenueEntryUsd: number | null;
  guaranteedPayoutUsd: number | null;
  kalshiFeeUsd: number | null;
  secondVenueFeeUsd: number | null;
  capitalLockCostUsd: number;
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

type GammaMarket = {
  id?: string;
  conditionId?: string;
  condition_id?: string;
  question?: string;
  outcomes?: string | string[];
  clobTokenIds?: string | string[];
  clob_token_ids?: string[];
  active?: boolean;
  closed?: boolean;
};
type BookLevel = { price?: string | number; size?: string | number };
type ClobBook = { asset_id?: string; asks?: BookLevel[]; timestamp?: string | number };

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
let latest: CrossVenueEventArbitrageCandidate[] = [];
let cycles = 0;
let errors = 0;
let lastCompletedAt: number | null = null;

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
function mappings(): EventVenueEquivalenceMapping[] {
  const raw = process.env.CRYPTOCRAWL_PREDICTION_EQUIVALENCE_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row: any) => {
      const candidate: EventVenueEquivalenceMapping = {
        kalshiTicker: String(row?.kalshiTicker || '').trim().toUpperCase(),
        secondVenue: 'polymarket',
        secondVenueMarketId: String(row?.secondVenueMarketId || '').trim(),
        secondVenueConditionId: String(row?.secondVenueConditionId || '').trim(),
        resolutionCriteriaFingerprint: String(row?.resolutionCriteriaFingerprint || '').trim(),
        settlementSourceFingerprint: String(row?.settlementSourceFingerprint || '').trim(),
        cutoffAt: Number(row?.cutoffAt),
        timezone: String(row?.timezone || '').trim(),
        voidTreatmentFingerprint: String(row?.voidTreatmentFingerprint || '').trim(),
        payoutDefinitionFingerprint: String(row?.payoutDefinitionFingerprint || '').trim(),
        settlementTimingFingerprint: String(row?.settlementTimingFingerprint || '').trim(),
        reviewedAt: Number(row?.reviewedAt),
        reviewer: String(row?.reviewer || '').trim(),
      };
      const complete = candidate.kalshiTicker && candidate.secondVenueMarketId && candidate.secondVenueConditionId
        && candidate.resolutionCriteriaFingerprint && candidate.settlementSourceFingerprint
        && Number.isFinite(candidate.cutoffAt) && candidate.cutoffAt > Date.now()
        && candidate.timezone && candidate.voidTreatmentFingerprint && candidate.payoutDefinitionFingerprint
        && candidate.settlementTimingFingerprint && Number.isFinite(candidate.reviewedAt) && candidate.reviewedAt > 0 && candidate.reviewer;
      return complete ? [candidate] : [];
    });
  } catch { return []; }
}
function binaryTokenIds(market: GammaMarket): { yes: string; no: string } | null {
  const outcomes = parseStringArray(market.outcomes).map(value => value.trim().toLowerCase());
  const ids = market.clob_token_ids?.map(String) || parseStringArray(market.clobTokenIds);
  const yes = outcomes.indexOf('yes');
  const no = outcomes.indexOf('no');
  return yes >= 0 && no >= 0 && ids[yes] && ids[no] ? { yes: ids[yes], no: ids[no] } : null;
}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json() as Promise<T>;
}
async function secondMarket(mapping: EventVenueEquivalenceMapping): Promise<GammaMarket | null> {
  const rows = await json<GammaMarket[]>(`${GAMMA}/markets?id=${encodeURIComponent(mapping.secondVenueMarketId)}`, { headers: { accept: 'application/json' } });
  const market = Array.isArray(rows) ? rows[0] : null;
  if (!market || market.closed === true || market.active === false) return null;
  const condition = String(market.conditionId || market.condition_id || '').trim();
  return condition === mapping.secondVenueConditionId ? market : null;
}
async function bestAsk(tokenId: string): Promise<{ price: number; size: number; observedAt: number } | null> {
  const book = await json<ClobBook>(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`, { headers: { accept: 'application/json' } });
  const levels = (Array.isArray(book?.asks) ? book.asks : []).map(row => ({ price: Number(row.price), size: Number(row.size) }))
    .filter(row => Number.isFinite(row.price) && row.price > 0 && row.price < 1 && Number.isFinite(row.size) && row.size > 0)
    .sort((a, b) => a.price - b.price);
  const top = levels[0];
  if (!top) return null;
  const timestamp = Number(book.timestamp);
  return { ...top, observedAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now() };
}
function mappingFingerprint(mapping: EventVenueEquivalenceMapping): string {
  return sha(JSON.stringify({
    resolution: mapping.resolutionCriteriaFingerprint,
    settlement: mapping.settlementSourceFingerprint,
    cutoffAt: mapping.cutoffAt,
    timezone: mapping.timezone,
    void: mapping.voidTreatmentFingerprint,
    payout: mapping.payoutDefinitionFingerprint,
    timing: mapping.settlementTimingFingerprint,
  }));
}
function secondVenueExecutionEvidence(): { authenticated: boolean; feeBps: number | null; prefundedSystemOwned: boolean } {
  // Deliberately no environment-supplied fee number or account balance can mint
  // execution authority. A future authenticated adapter must replace this seam.
  return { authenticated: false, feeBps: null, prefundedSystemOwned: false };
}

export async function refreshKalshiCrossVenueEventArbitrage(signals: KalshiPredictionMarketSignal[]): Promise<CrossVenueEventArbitrageCandidate[]> {
  const now = Date.now();
  const output: CrossVenueEventArbitrageCandidate[] = [];
  try {
    const byTicker = new Map(signals.map(signal => [signal.ticker.trim().toUpperCase(), signal]));
    for (const mapping of mappings()) {
      const signal = byTicker.get(mapping.kalshiTicker);
      if (!signal || !signal.rulesFingerprint || signal.expiresAt <= now) continue;
      const market = await secondMarket(mapping).catch(() => null);
      const ids = market ? binaryTokenIds(market) : null;
      if (!market || !ids) continue;
      const executionEvidence = secondVenueExecutionEvidence();
      for (const pair of [
        { kalshi: 'yes' as const, second: 'no' as const, secondToken: ids.no },
        { kalshi: 'no' as const, second: 'yes' as const, secondToken: ids.yes },
      ]) {
        const [kalshiOne, second] = await Promise.all([
          measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome: pair.kalshi, side: 'buy', contracts: 1, forceRefresh: true }),
          bestAsk(pair.secondToken).catch(() => null),
        ]);
        if (!kalshiOne?.complete || kalshiOne.vwapPrice === null || !second) continue;
        const maxContracts = Math.max(1, Math.floor(Math.min(1000, second.size)));
        const kalshi = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome: pair.kalshi, side: 'buy', contracts: maxContracts });
        if (!kalshi?.complete || kalshi.notionalUsd === null || kalshi.vwapPrice === null) continue;
        const fee = await estimateKalshiEventFees({ ticker: signal.ticker, contracts: maxContracts, price: kalshi.vwapPrice, forceRefresh: true });
        const semanticEquivalenceProven = mapping.resolutionCriteriaFingerprint === signal.rulesFingerprint
          && Boolean(mapping.settlementSourceFingerprint && mapping.voidTreatmentFingerprint && mapping.payoutDefinitionFingerprint && mapping.settlementTimingFingerprint);
        const secondVenueExecutionEvidenceProven = executionEvidence.authenticated && executionEvidence.prefundedSystemOwned && executionEvidence.feeBps !== null;
        const secondVenueEntryUsd = second.price * maxContracts;
        const secondVenueFeeUsd = executionEvidence.feeBps === null ? null : secondVenueEntryUsd * executionEvidence.feeBps / 10_000;
        const kalshiFeeUsd = fee?.economicCreditAllowed && fee.takerFeeUsd !== null ? fee.takerFeeUsd : null;
        const guaranteedPayoutUsd = maxContracts;
        const capitalLockCostUsd = 0;
        const guaranteedResidualUsd = kalshiFeeUsd !== null && secondVenueFeeUsd !== null
          ? guaranteedPayoutUsd - kalshi.notionalUsd - secondVenueEntryUsd - kalshiFeeUsd - secondVenueFeeUsd - capitalLockCostUsd
          : null;
        const missingEvidence = [
          ...(semanticEquivalenceProven ? [] : ['required:exact_semantic_equivalence']),
          ...(kalshiFeeUsd !== null ? [] : ['required:kalshi_exact_fee']),
          ...(secondVenueExecutionEvidenceProven ? [] : ['required:authenticated_second_venue_fees_prefunding_and_order_authority']),
          ...(guaranteedResidualUsd !== null && guaranteedResidualUsd > 0 ? [] : ['required:positive_guaranteed_residual_after_all_costs']),
          'required:non_atomic_leg_recovery_proof',
        ];
        const status: CrossVenueEventArbitrageCandidate['status'] = missingEvidence.length === 0 ? 'eligible' : 'data_collection';
        output.push({
          id: `kalshi-cross-event:${sha(`${signal.ticker}|${mappingFingerprint(mapping)}|${pair.kalshi}|${maxContracts}`).slice(0, 44)}`,
          kalshiTicker: signal.ticker,
          secondVenue: 'polymarket',
          secondVenueMarketId: mapping.secondVenueMarketId,
          matchedContracts: maxContracts,
          kalshiOutcome: pair.kalshi,
          secondVenueOutcome: pair.second,
          kalshiEntryUsd: kalshi.notionalUsd,
          secondVenueEntryUsd,
          guaranteedPayoutUsd,
          kalshiFeeUsd,
          secondVenueFeeUsd,
          capitalLockCostUsd,
          guaranteedResidualUsd,
          semanticEquivalenceProven,
          secondVenueExecutionEvidenceProven,
          status,
          missingEvidence,
          observedAt: Math.max(kalshi.observedAt, second.observedAt),
          expiresAt: Math.min(signal.expiresAt, kalshi.expiresAt, mapping.cutoffAt),
          executionAuthority: false,
          provenance: [
            ...signal.provenance,
            ...kalshi.provenance,
            `semantic_equivalence_mapping:${mappingFingerprint(mapping)}`,
            `mapping_reviewer:${mapping.reviewer}`,
            'cross_venue_complementary_payout:one_dollar_if_semantically_equivalent',
            'non_atomic_legging_risk:execution_blocking_until_recovery_proven',
            'second_venue_account_balance_mints_system_ownership:false',
            'execution_authority:false',
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
    nonAtomicLegRecoveryRequired: true as const,
    secondVenueAuthenticatedExecutionEvidenceRequired: true as const,
    executionAuthority: false as const,
  };
}
