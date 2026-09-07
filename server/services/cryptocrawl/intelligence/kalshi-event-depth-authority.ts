import logger from '../../../logger.js';
import { getKalshiApiOrigin } from './kalshi-authenticated-authority.js';

export type KalshiEventOutcome = 'yes' | 'no';
export type KalshiEventLiquiditySide = 'buy' | 'sell';

export interface KalshiEventDepthLevel {
  price: number;
  contracts: number;
}

export interface KalshiEventDepthSnapshot {
  ticker: string;
  yesBids: KalshiEventDepthLevel[];
  yesAsks: KalshiEventDepthLevel[];
  noBids: KalshiEventDepthLevel[];
  noAsks: KalshiEventDepthLevel[];
  observedAt: number;
  expiresAt: number;
  authenticated: false;
  executableDepthEvidence: true;
  synthetic: false;
  executionAuthority: false;
  provenance: string[];
}

export interface KalshiEventSizedDepth {
  ticker: string;
  outcome: KalshiEventOutcome;
  side: KalshiEventLiquiditySide;
  requestedContracts: number;
  filledContracts: number;
  complete: boolean;
  vwapPrice: number | null;
  worstPrice: number | null;
  notionalUsd: number | null;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

const CACHE_MS = Math.max(250, Math.min(10_000, Number(process.env.KALSHI_EVENT_DEPTH_CACHE_MS || 1_500)));
const TIMEOUT_MS = Math.max(1_000, Math.min(10_000, Number(process.env.KALSHI_EVENT_DEPTH_TIMEOUT_MS || 4_000)));
const DEPTH = Math.max(1, Math.min(100, Math.trunc(Number(process.env.KALSHI_EVENT_DEPTH_LEVELS || 100))));
const cache = new Map<string, KalshiEventDepthSnapshot>();
const inFlight = new Map<string, Promise<KalshiEventDepthSnapshot | null>>();

function positive(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function price(value: unknown): number | null {
  const parsed = positive(value);
  return parsed !== null && parsed < 1 ? Number(parsed.toFixed(4)) : null;
}

function normalizeBids(rows: unknown): KalshiEventDepthLevel[] {
  if (!Array.isArray(rows)) return [];
  const byPrice = new Map<number, number>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const p = price(row[0]);
    const contracts = positive(row[1]);
    if (p === null || contracts === null) continue;
    byPrice.set(p, (byPrice.get(p) || 0) + contracts);
  }
  return [...byPrice.entries()]
    .map(([p, contracts]) => ({ price: p, contracts }))
    .sort((left, right) => right.price - left.price);
}

function complementAsks(oppositeBids: readonly KalshiEventDepthLevel[]): KalshiEventDepthLevel[] {
  const byPrice = new Map<number, number>();
  for (const level of oppositeBids) {
    const p = Number((1 - level.price).toFixed(4));
    if (!(p > 0) || !(p < 1) || !(level.contracts > 0)) continue;
    byPrice.set(p, (byPrice.get(p) || 0) + level.contracts);
  }
  return [...byPrice.entries()]
    .map(([p, contracts]) => ({ price: p, contracts }))
    .sort((left, right) => left.price - right.price);
}

function clone(snapshot: KalshiEventDepthSnapshot): KalshiEventDepthSnapshot {
  return {
    ...snapshot,
    yesBids: snapshot.yesBids.map(row => ({ ...row })),
    yesAsks: snapshot.yesAsks.map(row => ({ ...row })),
    noBids: snapshot.noBids.map(row => ({ ...row })),
    noAsks: snapshot.noAsks.map(row => ({ ...row })),
    provenance: [...snapshot.provenance],
  };
}

async function fetchOrderbook(ticker: string): Promise<any> {
  const response = await fetch(`${getKalshiApiOrigin()}/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook?depth=${DEPTH}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Kalshi event orderbook failed HTTP ${response.status}`);
  return response.json();
}

/**
 * Kalshi's event orderbook returns YES bids and NO bids. In a binary $1 payout,
 * a NO bid at p is the executable YES ask at 1-p, and vice versa, with the same
 * contract count. This derives asks mechanically without inventing liquidity.
 */
export async function getKalshiEventDepth(tickerInput: string, forceRefresh = false): Promise<KalshiEventDepthSnapshot | null> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) return null;
  const prior = cache.get(ticker);
  if (!forceRefresh && prior && prior.expiresAt > Date.now()) return clone(prior);
  const pending = inFlight.get(ticker);
  if (pending) {
    const value = await pending;
    return value ? clone(value) : null;
  }

  const promise = (async (): Promise<KalshiEventDepthSnapshot | null> => {
    const payload = await fetchOrderbook(ticker);
    const yesBids = normalizeBids(payload?.orderbook_fp?.yes_dollars);
    const noBids = normalizeBids(payload?.orderbook_fp?.no_dollars);
    const observedAt = Date.now();
    const snapshot: KalshiEventDepthSnapshot = {
      ticker,
      yesBids,
      yesAsks: complementAsks(noBids),
      noBids,
      noAsks: complementAsks(yesBids),
      observedAt,
      expiresAt: observedAt + CACHE_MS,
      authenticated: false,
      executableDepthEvidence: true,
      synthetic: false,
      executionAuthority: false,
      provenance: [
        'kalshi_event_orderbook:live_public',
        `kalshi_orderbook_depth_levels:${DEPTH}`,
        'kalshi_yes_no_bids:direct_exchange_evidence',
        'binary_complement_asks:mechanically_derived_same_contract_size',
        'synthetic_liquidity:false',
        'execution_authority:false',
      ],
    };
    cache.set(ticker, snapshot);
    return snapshot;
  })().catch(error => {
    cache.delete(ticker);
    logger.debug('[KalshiEventDepth] Live event depth unavailable; route remains fail-closed', {
      component: 'KalshiEventDepthAuthority', ticker,
      error: error instanceof Error ? error.message : String(error),
      staleDepthRetained: false,
      syntheticDepthAllowed: false,
      executionAuthority: false,
    });
    return null;
  }).finally(() => inFlight.delete(ticker));
  inFlight.set(ticker, promise);
  const value = await promise;
  return value ? clone(value) : null;
}

export async function measureKalshiEventSizedDepth(input: {
  ticker: string;
  outcome: KalshiEventOutcome;
  side: KalshiEventLiquiditySide;
  contracts: number;
  forceRefresh?: boolean;
}): Promise<KalshiEventSizedDepth | null> {
  if (!(input.contracts > 0) || !Number.isFinite(input.contracts)) return null;
  const snapshot = await getKalshiEventDepth(input.ticker, input.forceRefresh === true);
  if (!snapshot) return null;
  const levels = input.outcome === 'yes'
    ? input.side === 'buy' ? snapshot.yesAsks : snapshot.yesBids
    : input.side === 'buy' ? snapshot.noAsks : snapshot.noBids;
  let remaining = input.contracts;
  let filledContracts = 0;
  let notionalUsd = 0;
  let worstPrice: number | null = null;
  for (const level of levels) {
    if (!(remaining > 1e-9)) break;
    const take = Math.min(remaining, level.contracts);
    if (!(take > 0)) continue;
    filledContracts += take;
    notionalUsd += take * level.price;
    remaining -= take;
    worstPrice = level.price;
  }
  const tolerance = Math.max(1e-8, input.contracts * 1e-8);
  const complete = remaining <= tolerance;
  return {
    ticker: snapshot.ticker,
    outcome: input.outcome,
    side: input.side,
    requestedContracts: input.contracts,
    filledContracts,
    complete,
    vwapPrice: complete && filledContracts > 0 ? notionalUsd / filledContracts : null,
    worstPrice: complete ? worstPrice : null,
    notionalUsd: complete ? notionalUsd : null,
    observedAt: snapshot.observedAt,
    expiresAt: snapshot.expiresAt,
    provenance: [
      ...snapshot.provenance,
      `event_depth_outcome:${input.outcome}`,
      `event_depth_side:${input.side}`,
      `event_depth_requested_contracts:${input.contracts}`,
      complete ? 'exact_sized_depth:complete' : 'exact_sized_depth:insufficient',
    ],
  };
}
