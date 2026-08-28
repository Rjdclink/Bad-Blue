import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
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

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
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
    ...feedback.symbol.toUpperCase().match(/[A-Z0-9]+/g) || [],
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

class RainbowProfitSourceLedger {
  private ready: Promise<void> | null = null;

  async recordTerminalSettlement(feedback: CryptaraExecutionFeedback): Promise<void> {
    if (!feedback.settlement || feedback.settlement.terminal !== true || feedback.settlement.settlementConfirmed !== true) return;
    if (feedback.success !== true || !Number.isFinite(Number(feedback.realizedProfitUsd ?? feedback.settlement.realized.netProfitUsd)) || Number(feedback.realizedProfitUsd ?? feedback.settlement.realized.netProfitUsd) <= 0) return;
    if (!isDatabaseConfigured) return;
    await this.ensureStore();
    const source = sourceSnapshot(feedback);
    await pool.query(
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
    );
  }

  async get(eventId: string): Promise<RainbowProfitSourceSnapshot | null> {
    if (!isDatabaseConfigured) return null;
    await this.ensureStore();
    const result = await pool.query(
      `SELECT event_id, execution_source, strategy, symbol, chain, venue_or_route, venues, assets, transaction_hash,
              EXTRACT(EPOCH FROM recorded_at) * 1000 AS recorded_at_ms
       FROM private.cryptocrawler_rainbow_profit_sources WHERE event_id=$1 LIMIT 1`,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
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
  }

  private async ensureStore(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await pool.query('CREATE SCHEMA IF NOT EXISTS private');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS private.cryptocrawler_rainbow_profit_sources (
          event_id text PRIMARY KEY,
          execution_source text NOT NULL,
          strategy text NOT NULL,
          symbol text NOT NULL,
          chain text,
          venue_or_route text,
          venues jsonb NOT NULL DEFAULT '[]'::jsonb,
          assets jsonb NOT NULL DEFAULT '[]'::jsonb,
          transaction_hash text,
          recorded_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_rainbow_profit_source_route ON private.cryptocrawler_rainbow_profit_sources(venue_or_route, symbol)');
    })().catch(error => {
      this.ready = null;
      logger.warn('[RainbowBridge] Source ledger unavailable; payout remains queued by primary ledger', {
        component: 'RainbowProfitSourceLedger',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    return this.ready;
  }
}

export const rainbowProfitSourceLedger = new RainbowProfitSourceLedger();
