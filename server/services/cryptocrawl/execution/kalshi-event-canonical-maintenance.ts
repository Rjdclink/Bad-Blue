import logger from '../../../logger.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { advanceKalshiEventLifecycles, type KalshiEventLifecycleResult } from './kalshi-event-lifecycle.js';

async function markOperatorTerminalByLifecycle(lifecycleId: string): Promise<void> {
  const lifecycle = await pool.query(
    `SELECT opportunity_id FROM private.cryptocrawler_kalshi_event_lifecycles WHERE lifecycle_id=$1 LIMIT 1`,
    [lifecycleId],
  );
  const opportunityId = String(lifecycle.rows?.[0]?.opportunity_id || '').trim();
  if (!opportunityId) return;
  const reservations = await pool.query(
    `SELECT reservation_id::text FROM public.cryptocrawler_operator_trade_reservations
     WHERE opportunity_id=$1 AND status='SUBMITTED' ORDER BY submitted_at ASC NULLS LAST`,
    [opportunityId],
  );
  for (const row of reservations.rows) {
    await operatorTradingStrategy.markTerminal(String(row.reservation_id));
  }
}

export async function maintainKalshiEventLifecycles(limit = 4): Promise<KalshiEventLifecycleResult[]> {
  const results = await advanceKalshiEventLifecycles(limit);
  for (const result of results) {
    if (!result.lifecycleId || !result.settlementConfirmed || result.status !== 'settled') continue;
    try {
      await markOperatorTerminalByLifecycle(result.lifecycleId);
    } catch (error) {
      logger.error('[KalshiEventMaintenance] Terminal operator reservation reconciliation deferred', {
        component: 'KalshiEventCanonicalMaintenance', lifecycleId: result.lifecycleId,
        error: error instanceof Error ? error.message : String(error),
        settlementAuthorityChanged: false, extraDailyTradeAllowed: false,
      });
      throw error;
    }
  }
  return results;
}
