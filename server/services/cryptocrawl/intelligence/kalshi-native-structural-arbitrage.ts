import logger from '../../../logger.js';
import { getKalshiApiOrigin } from './kalshi-authenticated-authority.js';
import { measureKalshiEventSizedDepth } from './kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from './kalshi-event-fee-authority.js';
import {
  getKalshiPredictionIntelligenceSnapshot,
  refreshKalshiPredictionIntelligence,
  type KalshiPredictionMarketSignal,
} from './kalshi-prediction-market-authority.js';

export type KalshiNativeStructuralKind = 'threshold_implication' | 'mutually_exclusive_basket' | 'mve_combo_implication';
export type KalshiNativeStructuralOutcome = 'yes' | 'no';

export interface KalshiNativeStructuralLeg {
  ticker: string;
  outcome: KalshiNativeStructuralOutcome;
  contracts: number;
  entryVwapUsd: number;
  entryCostUsd: number;
  entryFeeUsd: number;
}

export interface KalshiNativeStructuralCandidate {
  id: string;
  kind: KalshiNativeStructuralKind;
  eventTicker: string;
  relation: string;
  contracts: number;
  legs: KalshiNativeStructuralLeg[];
  guaranteedPayoutUsd: number;
  allInEntryCostUsd: number;
  netProfitUsd: number;
  netBps: number;
  observedAt: number;
  expiresAt: number;
  executable: false;
  atomicExecutionAvailable: false;
  synthetic: false;
  provenance: string[];
}

export interface KalshiNativeStructuralSnapshot {
  observedAt: number | null;
  cycles: number;
  errors: number;
  candidates: KalshiNativeStructuralCandidate[];
  thresholdRelationsScanned: number;
  mutuallyExclusiveEventsScanned: number;
  mveRelationsScanned: number;
  executionAuthority: false;
  broadSemanticMatchingUsed: false;
}

type LegSpec = { ticker: string; outcome: KalshiNativeStructuralOutcome };
type RelationSpec = {
  kind: KalshiNativeStructuralKind;
  eventTicker: string;
  relation: string;
  legs: LegSpec[];
  guaranteedPayoutPerContract: number;
  expiresAt: number;
  provenance: string[];
};

type ThresholdShape =
  | { kind: 'greater'; lower: number }
  | { kind: 'less'; upper: number }
  | { kind: 'between'; lower: number; upper: number };

const CACHE_MS = Math.max(5_000, Math.min(300_000, Number(process.env.KALSHI_STRUCTURAL_CACHE_MS || 30_000)));
const MAX_CONTRACTS = Math.max(1, Math.min(10_000, Math.trunc(Number(process.env.KALSHI_STRUCTURAL_MAX_CONTRACTS || 128))));
const MAX_RELATIONS = Math.max(10, Math.min(2_000, Math.trunc(Number(process.env.KALSHI_STRUCTURAL_MAX_RELATIONS || 250))));
const MAX_EVENT_PAGES = Math.max(1, Math.min(20, Math.trunc(Number(process.env.KALSHI_STRUCTURAL_EVENT_MAX_PAGES || 5))));
const EVENT_PAGE_SIZE = 200;

let snapshot: KalshiNativeStructuralSnapshot = {
  observedAt: null,
  cycles: 0,
  errors: 0,
  candidates: [],
  thresholdRelationsScanned: 0,
  mutuallyExclusiveEventsScanned: 0,
  mveRelationsScanned: 0,
  executionAuthority: false,
  broadSemanticMatchingUsed: false,
};
let inFlight: Promise<KalshiNativeStructuralSnapshot> | null = null;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function probability(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? Math.trunc(value * 1_000) : Math.trunc(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function publicJson<T>(path: string): Promise<T> {
  if (!path.startsWith('/trade-api/v2/')) throw new Error('Kalshi structural path rejected');
  const response = await fetch(`${getKalshiApiOrigin()}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, Number(process.env.KALSHI_STRUCTURAL_TIMEOUT_MS || 5_000)))),
  });
  if (!response.ok) throw new Error(`Kalshi structural request failed HTTP ${response.status} for ${path.split('?')[0]}`);
  return response.json() as Promise<T>;
}

async function pagedEvents(multivariate: boolean): Promise<any[]> {
  const rows: any[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(EVENT_PAGE_SIZE), with_nested_markets: 'true' });
    if (!multivariate) query.set('status', 'open');
    if (cursor) query.set('cursor', cursor);
    const path = multivariate ? '/trade-api/v2/events/multivariate' : '/trade-api/v2/events';
    const payload = await publicJson<any>(`${path}?${query.toString()}`);
    for (const event of Array.isArray(payload?.events) ? payload.events : []) {
      const ticker = String(event?.event_ticker || '').trim().toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      rows.push(event);
    }
    const next = String(payload?.cursor || '').trim();
    if (!next || next === cursor) break;
    cursor = next;
  }
  return rows;
}

function thresholdShape(signal: KalshiPredictionMarketSignal): ThresholdShape | null {
  const type = String(signal.strikeType || '').trim().toLowerCase();
  if ((type === 'greater' || type === 'greater_than' || type === 'above') && signal.floorStrike !== null) {
    return { kind: 'greater', lower: signal.floorStrike };
  }
  if ((type === 'less' || type === 'less_than' || type === 'below') && signal.capStrike !== null) {
    return { kind: 'less', upper: signal.capStrike };
  }
  if ((type === 'between' || type === 'range') && signal.floorStrike !== null && signal.capStrike !== null && signal.capStrike > signal.floorStrike) {
    return { kind: 'between', lower: signal.floorStrike, upper: signal.capStrike };
  }
  return null;
}

function sameSettlementWindow(a: KalshiPredictionMarketSignal, b: KalshiPredictionMarketSignal): boolean {
  if (!a.eventTicker || a.eventTicker !== b.eventTicker) return false;
  if (a.occurrenceAt !== null && b.occurrenceAt !== null && a.occurrenceAt !== b.occurrenceAt) return false;
  if (a.expectedExpirationAt !== null && b.expectedExpirationAt !== null && a.expectedExpirationAt !== b.expectedExpirationAt) return false;
  return true;
}

function thresholdRelation(a: KalshiPredictionMarketSignal, b: KalshiPredictionMarketSignal): RelationSpec | null {
  if (!sameSettlementWindow(a, b)) return null;
  const left = thresholdShape(a);
  const right = thresholdShape(b);
  if (!left || !right || left.kind !== right.kind) return null;
  const expiry = Math.min(a.expiresAt, b.expiresAt, a.expectedExpirationAt ?? Infinity, b.expectedExpirationAt ?? Infinity);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;

  if (left.kind === 'greater' && right.kind === 'greater' && left.lower !== right.lower) {
    const lower = left.lower < right.lower ? a : b;
    const higher = left.lower < right.lower ? b : a;
    return {
      kind: 'threshold_implication', eventTicker: a.eventTicker,
      relation: `${higher.ticker}:YES implies ${lower.ticker}:YES`,
      legs: [{ ticker: lower.ticker, outcome: 'yes' }, { ticker: higher.ticker, outcome: 'no' }],
      guaranteedPayoutPerContract: 1, expiresAt: expiry,
      provenance: ['kalshi_native_threshold:greater', 'same_event_ticker:true', 'same_settlement_window:true'],
    };
  }
  if (left.kind === 'less' && right.kind === 'less' && left.upper !== right.upper) {
    const lower = left.upper < right.upper ? a : b;
    const higher = left.upper < right.upper ? b : a;
    return {
      kind: 'threshold_implication', eventTicker: a.eventTicker,
      relation: `${lower.ticker}:YES implies ${higher.ticker}:YES`,
      legs: [{ ticker: lower.ticker, outcome: 'no' }, { ticker: higher.ticker, outcome: 'yes' }],
      guaranteedPayoutPerContract: 1, expiresAt: expiry,
      provenance: ['kalshi_native_threshold:less', 'same_event_ticker:true', 'same_settlement_window:true'],
    };
  }
  if (left.kind === 'between' && right.kind === 'between') {
    const leftInsideRight = left.lower >= right.lower && left.upper <= right.upper && (left.lower > right.lower || left.upper < right.upper);
    const rightInsideLeft = right.lower >= left.lower && right.upper <= left.upper && (right.lower > left.lower || right.upper < left.upper);
    if (!leftInsideRight && !rightInsideLeft) return null;
    const inner = leftInsideRight ? a : b;
    const outer = leftInsideRight ? b : a;
    return {
      kind: 'threshold_implication', eventTicker: a.eventTicker,
      relation: `${inner.ticker}:YES implies ${outer.ticker}:YES`,
      legs: [{ ticker: inner.ticker, outcome: 'no' }, { ticker: outer.ticker, outcome: 'yes' }],
      guaranteedPayoutPerContract: 1, expiresAt: expiry,
      provenance: ['kalshi_native_threshold:contained_range', 'same_event_ticker:true', 'same_settlement_window:true'],
    };
  }
  return null;
}

function approximateAsk(signalByTicker: Map<string, KalshiPredictionMarketSignal>, leg: LegSpec): number | null {
  const signal = signalByTicker.get(leg.ticker);
  if (!signal) return null;
  return leg.outcome === 'yes' ? signal.yesAsk : signal.noAsk;
}

function relationCouldBeProfitable(spec: RelationSpec, signalByTicker: Map<string, KalshiPredictionMarketSignal>): boolean {
  let cost = 0;
  for (const leg of spec.legs) {
    const ask = approximateAsk(signalByTicker, leg);
    if (ask === null) return true;
    cost += ask;
  }
  return cost < spec.guaranteedPayoutPerContract;
}

function contractSizes(): number[] {
  const sizes = new Set<number>([1, MAX_CONTRACTS]);
  for (let value = 2; value < MAX_CONTRACTS; value *= 2) sizes.add(value);
  return [...sizes].filter(value => value <= MAX_CONTRACTS).sort((a, b) => a - b);
}

async function evaluateRelation(spec: RelationSpec): Promise<KalshiNativeStructuralCandidate | null> {
  let best: KalshiNativeStructuralCandidate | null = null;
  for (const contracts of contractSizes()) {
    const legs: KalshiNativeStructuralLeg[] = [];
    let allInEntryCostUsd = 0;
    let expiresAt = spec.expiresAt;
    let complete = true;
    for (const leg of spec.legs) {
      const depth = await measureKalshiEventSizedDepth({
        ticker: leg.ticker,
        outcome: leg.outcome,
        side: 'buy',
        contracts,
        forceRefresh: false,
      }).catch(() => null);
      if (!depth?.complete || depth.vwapPrice === null || depth.notionalUsd === null || depth.expiresAt <= Date.now()) {
        complete = false;
        break;
      }
      const fee = await estimateKalshiEventFees({ ticker: leg.ticker, contracts, price: depth.vwapPrice }).catch(() => null);
      if (!fee?.economicCreditAllowed || fee.takerFeeUsd === null || fee.expiresAt <= Date.now()) {
        complete = false;
        break;
      }
      const entryFeeUsd = fee.takerFeeUsd;
      allInEntryCostUsd += depth.notionalUsd + entryFeeUsd;
      expiresAt = Math.min(expiresAt, depth.expiresAt, fee.expiresAt);
      legs.push({
        ticker: leg.ticker,
        outcome: leg.outcome,
        contracts,
        entryVwapUsd: depth.vwapPrice,
        entryCostUsd: depth.notionalUsd,
        entryFeeUsd,
      });
    }
    if (!complete || legs.length !== spec.legs.length) continue;
    const guaranteedPayoutUsd = spec.guaranteedPayoutPerContract * contracts;
    const netProfitUsd = guaranteedPayoutUsd - allInEntryCostUsd;
    if (!(netProfitUsd > 0) || !(allInEntryCostUsd > 0)) continue;
    const candidate: KalshiNativeStructuralCandidate = {
      id: `kalshi-structural:${spec.kind}:${spec.legs.map(leg => `${leg.ticker}:${leg.outcome}`).join('+')}:${contracts}`,
      kind: spec.kind,
      eventTicker: spec.eventTicker,
      relation: spec.relation,
      contracts,
      legs,
      guaranteedPayoutUsd,
      allInEntryCostUsd,
      netProfitUsd,
      netBps: netProfitUsd / allInEntryCostUsd * 10_000,
      observedAt: Date.now(),
      expiresAt,
      executable: false,
      atomicExecutionAvailable: false,
      synthetic: false,
      provenance: [
        ...spec.provenance,
        'kalshi_orderbook_fp:exact_full_depth',
        'kalshi_fee_authority:current_all_in',
        'strict_positive_guaranteed_residual:true',
        'capital_lock_cost:ranking_only_not_profitability_gate',
        'multi_market_atomic_execution:unproven_fail_closed',
        'broad_semantic_matching:false',
      ],
    };
    if (!best || candidate.netProfitUsd > best.netProfitUsd || (candidate.netProfitUsd === best.netProfitUsd && candidate.netBps > best.netBps)) best = candidate;
  }
  return best;
}

function mutuallyExclusiveSpecs(events: any[]): RelationSpec[] {
  const specs: RelationSpec[] = [];
  for (const event of events) {
    if (event?.mutually_exclusive !== true) continue;
    const eventTicker = String(event?.event_ticker || '').trim().toUpperCase();
    const markets = (Array.isArray(event?.markets) ? event.markets : [])
      .filter((market: any) => ['active', 'open'].includes(String(market?.status || '').toLowerCase()))
      .map((market: any) => ({ ticker: String(market?.ticker || '').trim().toUpperCase(), expiry: timestamp(market?.expected_expiration_time) ?? timestamp(market?.expiration_time) }))
      .filter((market: any) => market.ticker);
    if (!eventTicker || markets.length < 2 || markets.length > 24) continue;
    const expiry = Math.min(...markets.map((market: any) => market.expiry ?? Date.now() + CACHE_MS));
    if (!(expiry > Date.now())) continue;
    specs.push({
      kind: 'mutually_exclusive_basket',
      eventTicker,
      relation: `${eventTicker}:at most one YES`,
      legs: markets.map((market: any) => ({ ticker: market.ticker, outcome: 'no' as const })),
      guaranteedPayoutPerContract: markets.length - 1,
      expiresAt: expiry,
      provenance: ['kalshi_event_metadata:mutually_exclusive=true', 'native_event_membership:authoritative', 'at_most_one_yes:guaranteed'],
    });
  }
  return specs;
}

function mveSpecs(events: any[]): RelationSpec[] {
  const specs: RelationSpec[] = [];
  for (const event of events) {
    const eventTicker = String(event?.event_ticker || '').trim().toUpperCase();
    for (const market of Array.isArray(event?.markets) ? event.markets : []) {
      const comboTicker = String(market?.ticker || '').trim().toUpperCase();
      const collectionTicker = String(market?.mve_collection_ticker || '').trim().toUpperCase();
      const selected = Array.isArray(market?.mve_selected_legs) ? market.mve_selected_legs : [];
      const expiry = timestamp(market?.expected_expiration_time) ?? timestamp(market?.expiration_time) ?? Date.now() + CACHE_MS;
      if (!eventTicker || !comboTicker || !collectionTicker || selected.length === 0 || expiry <= Date.now()) continue;
      for (const leg of selected) {
        const legTicker = String(leg?.market_ticker || '').trim().toUpperCase();
        const side = String(leg?.side || '').trim().toLowerCase();
        if (!legTicker || (side !== 'yes' && side !== 'no')) continue;
        specs.push({
          kind: 'mve_combo_implication',
          eventTicker,
          relation: `${comboTicker}:YES implies ${legTicker}:${side.toUpperCase()}`,
          legs: [{ ticker: comboTicker, outcome: 'no' }, { ticker: legTicker, outcome: side as KalshiNativeStructuralOutcome }],
          guaranteedPayoutPerContract: 1,
          expiresAt: expiry,
          provenance: [
            `kalshi_mve_collection:${collectionTicker}`,
            'kalshi_mve_selected_legs:authoritative',
            'combo_yes_implies_selected_leg:true',
          ],
        });
      }
    }
  }
  return specs;
}

export async function refreshKalshiNativeStructuralArbitrage(forceRefresh = false): Promise<KalshiNativeStructuralSnapshot> {
  const now = Date.now();
  if (!forceRefresh && snapshot.observedAt !== null && now - snapshot.observedAt <= CACHE_MS) return getKalshiNativeStructuralSnapshot();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await refreshKalshiPredictionIntelligence(forceRefresh).catch(() => undefined);
    const prediction = getKalshiPredictionIntelligenceSnapshot();
    const signalByTicker = new Map(prediction.markets.map(signal => [signal.ticker, signal]));
    const thresholdSpecs: RelationSpec[] = [];
    const byEvent = new Map<string, KalshiPredictionMarketSignal[]>();
    for (const signal of prediction.markets) {
      if (!signal.eventTicker || !thresholdShape(signal)) continue;
      const group = byEvent.get(signal.eventTicker) ?? [];
      group.push(signal);
      byEvent.set(signal.eventTicker, group);
    }
    for (const group of byEvent.values()) {
      for (let left = 0; left < group.length; left++) {
        for (let right = left + 1; right < group.length; right++) {
          const relation = thresholdRelation(group[left], group[right]);
          if (relation) thresholdSpecs.push(relation);
          if (thresholdSpecs.length >= MAX_RELATIONS) break;
        }
        if (thresholdSpecs.length >= MAX_RELATIONS) break;
      }
      if (thresholdSpecs.length >= MAX_RELATIONS) break;
    }

    const [nativeEvents, mveEvents] = await Promise.all([
      pagedEvents(false).catch(() => []),
      pagedEvents(true).catch(() => []),
    ]);
    const mutexSpecs = mutuallyExclusiveSpecs(nativeEvents);
    const comboSpecs = mveSpecs(mveEvents);
    const allSpecs = [...thresholdSpecs, ...mutexSpecs, ...comboSpecs]
      .filter(spec => relationCouldBeProfitable(spec, signalByTicker))
      .slice(0, MAX_RELATIONS);
    const candidates: KalshiNativeStructuralCandidate[] = [];
    for (const spec of allSpecs) {
      const candidate = await evaluateRelation(spec).catch(() => null);
      if (candidate) candidates.push(candidate);
    }
    candidates.sort((a, b) => b.netProfitUsd - a.netProfitUsd || b.netBps - a.netBps || a.expiresAt - b.expiresAt);
    snapshot = {
      observedAt: Date.now(),
      cycles: snapshot.cycles + 1,
      errors: snapshot.errors,
      candidates,
      thresholdRelationsScanned: thresholdSpecs.length,
      mutuallyExclusiveEventsScanned: mutexSpecs.length,
      mveRelationsScanned: comboSpecs.length,
      executionAuthority: false,
      broadSemanticMatchingUsed: false,
    };
    return getKalshiNativeStructuralSnapshot();
  })().catch(error => {
    snapshot = {
      ...snapshot,
      observedAt: Date.now(),
      cycles: snapshot.cycles + 1,
      errors: snapshot.errors + 1,
      candidates: [],
    };
    logger.warn('[KalshiStructural] Native structural scan failed locally', {
      component: 'KalshiNativeStructuralArbitrage',
      error: error instanceof Error ? error.message : String(error),
      broadSemanticMatchingUsed: false,
      ordinaryKalshiExecutionBlocked: false,
    });
    return getKalshiNativeStructuralSnapshot();
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function getKalshiNativeStructuralSnapshot(): KalshiNativeStructuralSnapshot {
  const now = Date.now();
  return {
    ...snapshot,
    candidates: snapshot.candidates
      .filter(candidate => candidate.expiresAt > now)
      .map(candidate => ({
        ...candidate,
        legs: candidate.legs.map(leg => ({ ...leg })),
        provenance: [...candidate.provenance],
      })),
  };
}
