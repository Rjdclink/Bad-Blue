import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import {
  enqueueCryptaraHyperBridgeSnapshot,
  noteCryptaraHyperBridgeReplicaFresh,
  readCryptaraHyperBridge,
} from '../integration/cryptara-supabase-hyper-bridge.js';
import {
  isCryptaraPrimaryArchiveConfigured,
  queryCryptaraPrimaryArchive,
} from '../integration/cryptara-primary-archive-worker.js';
import {
  isCryptaraParallelProxyConfigured,
  readCryptaraParallelSnapshot,
} from '../integration/cryptara-supabase-overflow-worker.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';

export interface RainbowProfitSourceSnapshot {
  eventId: string;
  executionSource: CryptaraExecutionFeedback['source'];
  strategy: string;
  symbol: string;
  chain: string | null;
  venueOrRoute: string | null;
  venues: string[];
  assets: string[];
  transactionHash: string | null;
  recordedAt: number;
}

const PARALLEL_PROXY_TOPIC = 'rainbow-profit-source';
const REPLICA_ROUTE_FRESH_MS = 5 * 60_000;

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
}

function symbolAssets(symbol: string): string[] {
  const normalized = symbol.trim().toUpperCase().replace(/[-_/]/g, '');
  const quotes = ['USDT', 'USDC', 'USD', 'EUR', 'BTC', 'ETH'];
  const quote = quotes.find(candidate => normalized.endsWith(candidate));
  if (!quote) return normalized ? [normalized] : [];
  const base = normalized.slice(0, -quote.length);
  return unique([base, quote]);
}

function sourceSnapshot(feedback: CryptaraExecutionFeedback): RainbowProfitSourceSnapshot {
  const settlement = feedback.settlement!;
  const venues = unique([
    ...(settlement.orders || []).map(order => order.venue),
    settlement.venueOrRoute,
  ]);
  const assets = unique([
    ...(settlement.orders || []).flatMap(order => [order.feeAsset]),
    ...(settlement.tokenAmounts || []).map(amount => amount.token),
    ...symbolAssets(feedback.symbol),
  ]);
  return {
    eventId: terminalFeedbackIdentity(feedback),
    executionSource: feedback.source,
    strategy: feedback.strategy,
    symbol: feedback.symbol.toUpperCase(),
    chain: settlement.chain || feedback.chain || null,
    venueOrRoute: settlement.venueOrRoute || null,
    venues,
    assets,
    transactionHash: settlement.transactionHash || null,
    recordedAt: Date.now(),
  };
}

function enqueueOverflowSourceMirror(source: RainbowProfitSourceSnapshot): void {
  if (!isCryptaraParallelProxyConfigured) return;
  enqueueCryptaraHyperBridgeSnapshot({
    artifact: {
      key: source.eventId,
      workload: 'observability',
      topic: PARALLEL_PROXY_TOPIC,
      payload: source,
      observedAt: source.recordedAt,
    },
    replicaFreshForMs: REPLICA_ROUTE_FRESH_MS,
  });
}

async function persistPrimaryArchiveSource(source: RainbowProfitSourceSnapshot): Promise<void> {
  if (!isCryptaraPrimaryArchiveConfigured) return;
  await queryCryptaraPrimaryArchive(
    `INSERT INTO private.cryptocrawler_rainbow_profit_sources
      (event_id, execution_source, strategy, symbol, chain, venue_or_route, venues, assets, transaction_hash, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,to_timestamp($10/1000.0))
     ON CONFLICT (event_id) DO UPDATE SET
       execution_source=EXCLUDED.execution_source,
       strategy=EXCLUDED.strategy,
       symbol=EXCLUDED.symbol,
       chain=EXCLUDED.chain,
       venue_or_route=EXCLUDED.venue_or_route,
       venues=EXCLUDED.venues,
       assets=EXCLUDED.assets,
       transaction_hash=COALESCE(EXCLUDED.transaction_hash, private.cryptocrawler_rainbow_profit_sources.transaction_hash),
       recorded_at=EXCLUDED.recorded_at`,
    [
      source.eventId,
      source.executionSource,
      source.strategy,
      source.symbol,
      source.chain,
      source.venueOrRoute,
      JSON.stringify(source.venues),
      JSON.stringify(source.assets),
      source.transactionHash,
      source.recordedAt,
    ],
    'rainbow_profit_source_write',
  );
}

async function readPrimaryArchiveSource(eventId: string): Promise<RainbowProfitSourceSnapshot | null> {
  if (!isCryptaraPrimaryArchiveConfigured) return null;
  const result = await queryCryptaraPrimaryArchive(
    `SELECT event_id, execution_source, strategy, symbol, chain, venue_or_route, venues, assets, transaction_hash,
            EXTRACT(EPOCH FROM recorded_at) * 1000 AS recorded_at_ms
     FROM private.cryptocrawler_rainbow_profit_sources WHERE event_id=$1 LIMIT 1`,
    [eventId],
    'rainbow_profit_source_lookup',
  );
  const row = result.rows[0];
  if (!row) return null;
  const source: RainbowProfitSourceSnapshot = {
    eventId: String(row.event_id),
    executionSource: row.execution_source as CryptaraExecutionFeedback['source'],
    strategy: String(row.strategy),
    symbol: String(row.symbol),
    chain: row.chain ? String(row.chain) : null,
    venueOrRoute: row.venue_or_route ? String(row.venue_or_route) : null,
    venues: Array.isArray(row.venues) ? row.venues.map(String) : [],
    assets: Array.isArray(row.assets) ? row.assets.map(String) : [],
    transactionHash: row.transaction_hash ? String(row.transaction_hash) : null,
    recordedAt: Number(row.recorded_at_ms),
  };

  // Historical Primary hit is immediately rehydrated into Overflow so repeated
  // runtime lookups stay on the hot plane instead of repeatedly touching archive.
  enqueueOverflowSourceMirror(source);
  return source;
}

async function readOverflowSource(eventId: string): Promise<RainbowProfitSourceSnapshot | null> {
  if (!isCryptaraParallelProxyConfigured) return null;
  const proxied = await readCryptaraParallelSnapshot<RainbowProfitSourceSnapshot>(
    'observability',
    eventId,
    PARALLEL_PROXY_TOPIC,
  );
  const value = proxied.used ? proxied.value?.payload ?? null : null;
  if (!value) return null;
  noteCryptaraHyperBridgeReplicaFresh({
    key: eventId,
    workload: 'observability',
    topic: PARALLEL_PROXY_TOPIC,
    expiresAt: Date.now() + REPLICA_ROUTE_FRESH_MS,
  });
  return value;
}

class RainbowProfitSourceLedger {
  async recordTerminalSettlement(feedback: CryptaraExecutionFeedback): Promise<void> {
    if (!feedback.settlement || feedback.settlement.terminal !== true || feedback.settlement.settlementConfirmed !== true) return;
    const realized = Number(feedback.realizedProfitUsd ?? feedback.settlement.realized.netProfitUsd);
    if (feedback.success !== true || !Number.isFinite(realized) || realized <= 0) return;
    const source = sourceSnapshot(feedback);

    // Overflow is the live source. Primary is cold memory. Publish hot state first,
    // then archive the immutable settlement-source metadata asynchronously through
    // the sole Primary archive worker/Bridge gateway. Archive latency can never
    // block terminal settlement or become execution authority.
    enqueueOverflowSourceMirror(source);
    if (isCryptaraPrimaryArchiveConfigured) {
      queueMicrotask(() => {
        void persistPrimaryArchiveSource(source).catch(() => undefined);
      });
    }
  }

  async get(eventId: string): Promise<RainbowProfitSourceSnapshot | null> {
    // Every lookup enters Overflow first. Only a genuine historical miss may ask
    // the explicit Primary archive worker; an archive hit is then rehydrated into
    // Overflow so future reads stay on the hot plane.
    const bridged = await readCryptaraHyperBridge<RainbowProfitSourceSnapshot>({
      key: eventId,
      workload: 'observability',
      topic: PARALLEL_PROXY_TOPIC,
      normalPreference: 'overflow',
      primary: () => readPrimaryArchiveSource(eventId),
      overflow: () => readOverflowSource(eventId),
      isUsable: value => Boolean(value?.eventId),
    });
    return bridged.value;
  }
}

export const rainbowProfitSourceLedger = new RainbowProfitSourceLedger();