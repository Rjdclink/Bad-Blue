import logger from '../../../logger.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  advanceKalshiCrossVenueEventLifecycles,
  type CrossVenueEventLifecycleResult,
} from './kalshi-cross-venue-event-lifecycle.js';
import {
  reconcileKalshiCrossVenueTerminalSettlements,
  type CrossVenueTerminalReconciliationResult,
} from './kalshi-cross-venue-terminal-reconciliation.js';
import { advanceKalshiEventLifecycles, type KalshiEventLifecycleResult } from './kalshi-event-lifecycle.js';
import {
  maintainKalshiEventMakerLifecycles,
  type KalshiEventMakerMaintenanceResult,
} from './kalshi-event-market-maker.js';
import { acquireKalshiCrossVenueMaintenanceLease } from './kalshi-event-resource-lease.js';

async function markOperatorTerminalByOpportunity(opportunityId: string): Promise<void> {
  const normalized = opportunityId.trim();
  if (!normalized) return;
  const reservations = await pool.query(
    `SELECT reservation_id::text FROM public.cryptocrawler_operator_trade_reservations
     WHERE opportunity_id=$1 AND status='SUBMITTED' ORDER BY submitted_at ASC NULLS LAST`,
    [normalized],
  );
  for (const row of reservations.rows) {
    await operatorTradingStrategy.markTerminal(String(row.reservation_id));
  }
}

async function markOperatorTerminalByLifecycle(lifecycleId: string): Promise<void> {
  const lifecycle = await pool.query(
    `SELECT opportunity_id FROM private.cryptocrawler_kalshi_event_lifecycles WHERE lifecycle_id=$1 LIMIT 1`,
    [lifecycleId],
  );
  const opportunityId = String(lifecycle.rows?.[0]?.opportunity_id || '').trim();
  if (!opportunityId) return;
  await markOperatorTerminalByOpportunity(opportunityId);
}

export interface KalshiCanonicalMaintenanceResult {
  directional: KalshiEventLifecycleResult[];
  maker: KalshiEventMakerMaintenanceResult[];
  crossVenue: CrossVenueEventLifecycleResult[];
  crossVenueTerminal: CrossVenueTerminalReconciliationResult[];
}

export async function maintainKalshiCanonicalLifecycles(limit = 4): Promise<KalshiCanonicalMaintenanceResult> {
  let crossVenue: CrossVenueEventLifecycleResult[] = [];
  let crossVenueTerminal: CrossVenueTerminalReconciliationResult[] = [];
  const crossVenueLease = await acquireKalshiCrossVenueMaintenanceLease();
  if (crossVenueLease) {
    try {
      crossVenue = await advanceKalshiCrossVenueEventLifecycles(limit);
      crossVenueTerminal = await reconcileKalshiCrossVenueTerminalSettlements(limit);
      for (const result of crossVenue) {
        if (!result.settlementConfirmed && result.status !== 'FAILED') continue;
        await markOperatorTerminalByOpportunity(result.opportunityId);
      }
      for (const result of crossVenueTerminal) {
        if (!result.terminal || result.status !== 'settled') continue;
        await markOperatorTerminalByOpportunity(result.opportunityId);
      }
    } catch (error) {
      logger.error('[KalshiEventMaintenance] Cross-venue lifecycle maintenance failed closed', {
        component: 'KalshiEventCanonicalMaintenance',
        error: error instanceof Error ? error.message : String(error),
        newExposureGranted: false, crossVenueResourceLeaseHeld: true,
        extraDailyTradeAllowed: false,
      });
      throw error;
    } finally {
      await crossVenueLease.release();
    }
  }

  const directional = await advanceKalshiEventLifecycles(limit);
  for (const result of directional) {
    if (!result.lifecycleId || (!result.settlementConfirmed && result.status !== 'failed')) continue;
    try {
      await markOperatorTerminalByLifecycle(result.lifecycleId);
    } catch (error) {
      logger.error('[KalshiEventMaintenance] Terminal operator reservation reconciliation deferred', {
        component: 'KalshiEventCanonicalMaintenance', lifecycleId: result.lifecycleId,
        status: result.status, settlementConfirmed: result.settlementConfirmed,
        error: error instanceof Error ? error.message : String(error),
        settlementAuthorityChanged: false, extraDailyTradeAllowed: false,
      });
      throw error;
    }
  }

  const maker = await maintainKalshiEventMakerLifecycles(limit);
  for (const result of maker) {
    if (!result.terminal) continue;
    try {
      await markOperatorTerminalByOpportunity(result.opportunityId);
    } catch (error) {
      logger.error('[KalshiEventMaintenance] Terminal maker operator reservation reconciliation deferred', {
        component: 'KalshiEventCanonicalMaintenance', lifecycleId: result.lifecycleId,
        opportunityId: result.opportunityId,
        status: result.status,
        error: error instanceof Error ? error.message : String(error),
        settlementAuthorityChanged: false, extraDailyTradeAllowed: false,
      });
      throw error;
    }
  }
  return { directional, maker, crossVenue, crossVenueTerminal };
}

export async function maintainKalshiEventLifecycles(limit = 4): Promise<KalshiEventLifecycleResult[]> {
  return (await maintainKalshiCanonicalLifecycles(limit)).directional;
}
