import { randomInt, randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';

const STRATEGY_TIMEZONE = 'America/Chicago';
const CYCLE_DAYS = 30;
const PROFIT_DAYS_TARGET = 20;
const BASELINE_ATTEMPT_DAYS_PER_CYCLE = 20;
const MIN_DAILY_TRADES = 1;
const MAX_DAILY_TRADES = 3;
const MIN_DAILY_PROFIT_CEILING_USD = 300;
const MAX_DAILY_PROFIT_CEILING_USD = 3_500;
const PROFIT_CUSHION_USD = 50;

export type OperatorStrategyBlockReason =
  | 'learning_day'
  | 'profit_day_target_reached'
  | 'daily_trade_limit'
  | 'daily_profit_stop';

export interface OperatorTradingStrategyState {
  localDate: string;
  cycleStart: string;
  cycleEnd: string;
  dayOffset: number;
  isTradeDay: boolean;
  learningMode: boolean;
  eligibilitySource: string;
  profitQualifiedDay: boolean;
  qualifiedProfitDays: number;
  profitDaysTarget: number;
  profitDaysRemaining: number;
  calendarDaysRemaining: number;
  targetStillMathematicallyReachable: boolean;
  maxTrades: number;
  submittedTrades: number;
  remainingTrades: number;
  profitCeilingUsd: number;
  stopProfitUsd: number;
  realizedProfitUsd: number;
  executionAllowed: boolean;
  blockReason: OperatorStrategyBlockReason | null;
}

export interface OperatorTradeReservation {
  allowed: boolean;
  reservationId: string | null;
  state: OperatorTradingStrategyState;
  reason: OperatorStrategyBlockReason | null;
}

function localDateKey(epochMs = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STRATEGY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateEpoch(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) throw new Error(`Invalid operator strategy date: ${dateKey}`);
  return Date.UTC(year, month - 1, day);
}

function addDays(dateKey: string, days: number): string {
  return new Date(dateEpoch(dateKey) + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  return Math.trunc((dateEpoch(right) - dateEpoch(left)) / 86_400_000);
}

function randomizedBaselineAttemptOffsets(): number[] {
  const offsets = Array.from({ length: CYCLE_DAYS }, (_, index) => index);
  for (let index = offsets.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [offsets[index], offsets[swapIndex]] = [offsets[swapIndex], offsets[index]];
  }
  const selected = offsets.slice(0, BASELINE_ATTEMPT_DAYS_PER_CYCLE).sort((a, b) => a - b);
  if (selected.length !== BASELINE_ATTEMPT_DAYS_PER_CYCLE || new Set(selected).size !== BASELINE_ATTEMPT_DAYS_PER_CYCLE) {
    throw new Error('Operator strategy failed to generate exactly 20 unique baseline attempt days');
  }
  if (selected.every((value, index) => value === index)) {
    return randomizedBaselineAttemptOffsets();
  }
  return selected;
}

function dailyProfitCeilingUsd(): number {
  return randomInt(MIN_DAILY_PROFIT_CEILING_USD, MAX_DAILY_PROFIT_CEILING_USD + 1);
}

function stateFromRow(row: any): OperatorTradingStrategyState {
  const maxTrades = Number(row.max_trades);
  const submittedTrades = Number(row.submitted_trades);
  const profitCeilingUsd = Number(row.profit_ceiling_usd);
  const stopProfitUsd = Number(row.stop_profit_usd);
  const realizedProfitUsd = Number(row.realized_profit_usd);
  const qualifiedProfitDays = Number(row.qualified_profit_days || 0);
  const profitDaysTarget = Number(row.profit_day_target || PROFIT_DAYS_TARGET);
  const dayOffset = Number(row.day_offset);
  const calendarDaysRemaining = Math.max(0, CYCLE_DAYS - dayOffset);
  const profitDaysRemaining = Math.max(0, profitDaysTarget - qualifiedProfitDays);
  const isTradeDay = row.is_trade_day === true;
  const targetReached = qualifiedProfitDays >= profitDaysTarget;
  let blockReason: OperatorStrategyBlockReason | null = null;
  if (targetReached) blockReason = 'profit_day_target_reached';
  else if (!isTradeDay) blockReason = 'learning_day';
  else if (realizedProfitUsd + 1e-9 >= stopProfitUsd) blockReason = 'daily_profit_stop';
  else if (submittedTrades >= maxTrades) blockReason = 'daily_trade_limit';
  return {
    localDate: String(row.local_date),
    cycleStart: String(row.cycle_start),
    cycleEnd: String(row.cycle_end),
    dayOffset,
    isTradeDay,
    learningMode: !isTradeDay || targetReached,
    eligibilitySource: String(row.eligibility_source || 'unknown'),
    profitQualifiedDay: row.profit_qualified === true,
    qualifiedProfitDays,
    profitDaysTarget,
    profitDaysRemaining,
    calendarDaysRemaining,
    targetStillMathematicallyReachable: profitDaysRemaining <= calendarDaysRemaining,
    maxTrades,
    submittedTrades,
    remainingTrades: Math.max(0, maxTrades - submittedTrades),
    profitCeilingUsd,
    stopProfitUsd,
    realizedProfitUsd,
    executionAllowed: blockReason === null,
    blockReason,
  };
}

async function finalizeDayEligibility(
  client: any,
  dateKey: string,
  cycleStart: string,
  dayOffset: number,
  baselineOffsets: number[],
): Promise<void> {
  const current = await client.query(
    `SELECT eligibility_decided
     FROM public.cryptocrawler_operator_strategy_days
     WHERE local_date=$1::date
     FOR UPDATE`,
    [dateKey],
  );
  if (current.rowCount !== 1) throw new Error(`Operator strategy day ${dateKey} is unavailable for eligibility`);
  if (current.rows[0].eligibility_decided === true) return;

  const progress = await client.query(
    `SELECT count(*) FILTER (WHERE profit_qualified=true)::int AS qualified_profit_days
     FROM public.cryptocrawler_operator_strategy_days
     WHERE cycle_start=$1::date`,
    [cycleStart],
  );
  const qualifiedProfitDays = Number(progress.rows[0]?.qualified_profit_days || 0);
  const neededProfitDays = Math.max(0, PROFIT_DAYS_TARGET - qualifiedProfitDays);
  const calendarDaysRemaining = Math.max(0, CYCLE_DAYS - dayOffset);
  const baselinePreferred = baselineOffsets.includes(dayOffset);
  const remainingBaselineDays = baselineOffsets.filter(offset => offset >= dayOffset).length;

  let isTradeDay = false;
  let eligibilitySource = 'learning_reserve';
  if (qualifiedProfitDays >= PROFIT_DAYS_TARGET) {
    eligibilitySource = 'profit_day_target_reached';
  } else if (baselinePreferred) {
    isTradeDay = true;
    eligibilitySource = 'baseline_randomized_attempt';
  } else if (calendarDaysRemaining <= neededProfitDays) {
    isTradeDay = true;
    eligibilitySource = 'catch_up_all_remaining_days';
  } else if (remainingBaselineDays < neededProfitDays) {
    isTradeDay = true;
    eligibilitySource = 'adaptive_reserve_promotion';
  }

  await client.query(
    `UPDATE public.cryptocrawler_operator_strategy_days
     SET is_trade_day=$2,
         eligibility_decided=true,
         eligibility_source=$3,
         updated_at=now()
     WHERE local_date=$1::date`,
    [dateKey, isTradeDay, eligibilitySource],
  );
}

async function ensureDayForDate(dateKey = localDateKey()): Promise<OperatorTradingStrategyState> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const control = await client.query(
      `SELECT system_key, timezone, anchor_date
       FROM public.cryptocrawler_operator_strategy_control
       WHERE system_key='cryptocrawler'
       FOR UPDATE`,
    );
    if (control.rowCount !== 1) throw new Error('Operator trading strategy control row is unavailable');
    if (String(control.rows[0].timezone) !== STRATEGY_TIMEZONE) {
      throw new Error(`Operator trading strategy timezone drifted from ${STRATEGY_TIMEZONE}`);
    }

    const anchorDate = control.rows[0].anchor_date ? String(control.rows[0].anchor_date) : dateKey;
    if (!control.rows[0].anchor_date) {
      await client.query(
        `UPDATE public.cryptocrawler_operator_strategy_control
         SET anchor_date=$1::date, updated_at=now()
         WHERE system_key='cryptocrawler'`,
        [anchorDate],
      );
    }
    if (daysBetween(anchorDate, dateKey) < 0) {
      throw new Error(`Operator strategy date ${dateKey} precedes durable anchor ${anchorDate}`);
    }

    const cycleIndex = Math.floor(daysBetween(anchorDate, dateKey) / CYCLE_DAYS);
    const cycleStart = addDays(anchorDate, cycleIndex * CYCLE_DAYS);
    const cycleEnd = addDays(cycleStart, CYCLE_DAYS - 1);
    let cycle = await client.query(
      `SELECT cycle_start, cycle_end, trade_day_offsets, profit_day_target
       FROM public.cryptocrawler_operator_strategy_cycles
       WHERE cycle_start=$1::date`,
      [cycleStart],
    );

    if (cycle.rowCount === 0) {
      const baselineOffsets = randomizedBaselineAttemptOffsets();
      await client.query(
        `INSERT INTO public.cryptocrawler_operator_strategy_cycles
          (cycle_start, cycle_end, trade_day_offsets, profit_day_target, created_at)
         VALUES ($1::date,$2::date,$3::smallint[],$4,now())`,
        [cycleStart, cycleEnd, baselineOffsets, PROFIT_DAYS_TARGET],
      );
      const baselineSet = new Set(baselineOffsets);
      for (let dayOffset = 0; dayOffset < CYCLE_DAYS; dayOffset += 1) {
        const ceiling = dailyProfitCeilingUsd();
        await client.query(
          `INSERT INTO public.cryptocrawler_operator_strategy_days
            (local_date, cycle_start, day_offset, is_trade_day, eligibility_decided, eligibility_source,
             max_trades, profit_ceiling_usd, stop_profit_usd, submitted_trades, realized_profit_usd,
             profit_qualified, created_at, updated_at)
           VALUES ($1::date,$2::date,$3,$4,false,'pending_dynamic_decision',$5,$6,$7,0,0,false,now(),now())
           ON CONFLICT (local_date) DO NOTHING`,
          [
            addDays(cycleStart, dayOffset),
            cycleStart,
            dayOffset,
            baselineSet.has(dayOffset),
            randomInt(MIN_DAILY_TRADES, MAX_DAILY_TRADES + 1),
            ceiling,
            ceiling - PROFIT_CUSHION_USD,
          ],
        );
      }
      cycle = await client.query(
        `SELECT cycle_start, cycle_end, trade_day_offsets, profit_day_target
         FROM public.cryptocrawler_operator_strategy_cycles
         WHERE cycle_start=$1::date`,
        [cycleStart],
      );
    }

    const offsets = (cycle.rows[0]?.trade_day_offsets || []).map((value: unknown) => Number(value));
    if (offsets.length !== BASELINE_ATTEMPT_DAYS_PER_CYCLE || new Set(offsets).size !== BASELINE_ATTEMPT_DAYS_PER_CYCLE) {
      throw new Error('Durable operator strategy cycle does not contain exactly 20 unique randomized baseline attempt days');
    }
    if (Number(cycle.rows[0]?.profit_day_target || 0) !== PROFIT_DAYS_TARGET) {
      throw new Error(`Durable operator strategy cycle profit-day target drifted from ${PROFIT_DAYS_TARGET}`);
    }

    const dayOffset = daysBetween(cycleStart, dateKey);
    await finalizeDayEligibility(client, dateKey, cycleStart, dayOffset, offsets);

    const day = await client.query(
      `SELECT d.local_date, d.cycle_start, c.cycle_end, c.profit_day_target, d.day_offset, d.is_trade_day,
              d.eligibility_source, d.profit_qualified, d.max_trades, d.submitted_trades,
              d.profit_ceiling_usd, d.stop_profit_usd, d.realized_profit_usd,
              (SELECT count(*) FROM public.cryptocrawler_operator_strategy_days q
               WHERE q.cycle_start=d.cycle_start AND q.profit_qualified=true)::int AS qualified_profit_days
       FROM public.cryptocrawler_operator_strategy_days d
       JOIN public.cryptocrawler_operator_strategy_cycles c USING (cycle_start)
       WHERE d.local_date=$1::date
       FOR UPDATE OF d`,
      [dateKey],
    );
    if (day.rowCount !== 1) throw new Error(`Operator strategy day ${dateKey} was not materialized`);
    await client.query('COMMIT');
    return stateFromRow(day.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    client.release();
  }
}

async function loadLockedDay(client: any, dateKey: string): Promise<OperatorTradingStrategyState> {
  const result = await client.query(
    `SELECT d.local_date, d.cycle_start, c.cycle_end, c.profit_day_target, d.day_offset, d.is_trade_day,
            d.eligibility_source, d.profit_qualified, d.max_trades, d.submitted_trades,
            d.profit_ceiling_usd, d.stop_profit_usd, d.realized_profit_usd,
            (SELECT count(*) FROM public.cryptocrawler_operator_strategy_days q
             WHERE q.cycle_start=d.cycle_start AND q.profit_qualified=true)::int AS qualified_profit_days
     FROM public.cryptocrawler_operator_strategy_days d
     JOIN public.cryptocrawler_operator_strategy_cycles c USING (cycle_start)
     WHERE d.local_date=$1::date
     FOR UPDATE OF d`,
    [dateKey],
  );
  if (result.rowCount !== 1) throw new Error(`Operator strategy day ${dateKey} is unavailable`);
  return stateFromRow(result.rows[0]);
}

class OperatorTradingStrategy {
  async getState(epochMs = Date.now()): Promise<OperatorTradingStrategyState> {
    return ensureDayForDate(localDateKey(epochMs));
  }

  async reserveTrade(opportunityId: string, strategy: string): Promise<OperatorTradeReservation> {
    const normalizedOpportunityId = opportunityId.trim();
    if (!normalizedOpportunityId) throw new Error('Operator trade slot requires an opportunity id');
    const normalizedStrategy = strategy.trim() || 'unknown';
    const dateKey = localDateKey();
    await ensureDayForDate(dateKey);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let state = await loadLockedDay(client, dateKey);
      const existing = await client.query(
        `SELECT reservation_id, status, local_date
         FROM public.cryptocrawler_operator_trade_reservations
         WHERE opportunity_id=$1
         FOR UPDATE`,
        [normalizedOpportunityId],
      );
      if (existing.rowCount === 1 && ['SUBMITTED','TERMINAL'].includes(String(existing.rows[0].status))) {
        await client.query('COMMIT');
        return { allowed: false, reservationId: null, state, reason: 'daily_trade_limit' };
      }

      if (!state.executionAllowed) {
        await client.query('COMMIT');
        return { allowed: false, reservationId: null, state, reason: state.blockReason };
      }

      const active = await client.query(
        `SELECT count(*)::int AS count
         FROM public.cryptocrawler_operator_trade_reservations
         WHERE local_date=$1::date AND status='RESERVED'`,
        [dateKey],
      );
      const reservedCount = Number(active.rows[0]?.count || 0);
      if (state.submittedTrades + reservedCount >= state.maxTrades) {
        state = { ...state, executionAllowed: false, blockReason: 'daily_trade_limit', remainingTrades: 0 };
        await client.query('COMMIT');
        return { allowed: false, reservationId: null, state, reason: 'daily_trade_limit' };
      }

      const reservationId = existing.rowCount === 1
        ? String(existing.rows[0].reservation_id)
        : randomUUID();
      if (existing.rowCount === 1) {
        await client.query(
          `UPDATE public.cryptocrawler_operator_trade_reservations
           SET local_date=$2::date, strategy=$3, status='RESERVED', submitted_at=NULL,
               terminal_at=NULL, updated_at=now()
           WHERE reservation_id=$1::uuid AND status='RELEASED'`,
          [reservationId, dateKey, normalizedStrategy],
        );
      } else {
        await client.query(
          `INSERT INTO public.cryptocrawler_operator_trade_reservations
            (reservation_id, opportunity_id, strategy, local_date, status, created_at, updated_at)
           VALUES ($1::uuid,$2,$3,$4::date,'RESERVED',now(),now())`,
          [reservationId, normalizedOpportunityId, normalizedStrategy, dateKey],
        );
      }
      await client.query('COMMIT');
      return { allowed: true, reservationId, state, reason: null };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async markSubmitted(reservationId: string): Promise<OperatorTradingStrategyState> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reservation = await client.query(
        `SELECT reservation_id, local_date, status
         FROM public.cryptocrawler_operator_trade_reservations
         WHERE reservation_id=$1::uuid
         FOR UPDATE`,
        [reservationId],
      );
      if (reservation.rowCount !== 1) throw new Error(`Operator trade reservation ${reservationId} does not exist`);
      const dateKey = String(reservation.rows[0].local_date);
      let state = await loadLockedDay(client, dateKey);
      const status = String(reservation.rows[0].status);
      if (status === 'RESERVED') {
        if (state.submittedTrades >= state.maxTrades) {
          throw new Error(`Operator daily trade limit was reached before reservation ${reservationId} submitted`);
        }
        await client.query(
          `UPDATE public.cryptocrawler_operator_trade_reservations
           SET status='SUBMITTED', submitted_at=now(), updated_at=now()
           WHERE reservation_id=$1::uuid AND status='RESERVED'`,
          [reservationId],
        );
        await client.query(
          `UPDATE public.cryptocrawler_operator_strategy_days
           SET submitted_trades=submitted_trades+1, updated_at=now()
           WHERE local_date=$1::date`,
          [dateKey],
        );
        state = await loadLockedDay(client, dateKey);
      }
      await client.query('COMMIT');
      return state;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseReservation(reservationId: string): Promise<void> {
    await pool.query(
      `UPDATE public.cryptocrawler_operator_trade_reservations
       SET status='RELEASED', updated_at=now()
       WHERE reservation_id=$1::uuid AND status='RESERVED'`,
      [reservationId],
    );
  }

  async markTerminal(reservationId: string): Promise<void> {
    await pool.query(
      `UPDATE public.cryptocrawler_operator_trade_reservations
       SET status='TERMINAL', terminal_at=COALESCE(terminal_at, now()), updated_at=now()
       WHERE reservation_id=$1::uuid AND status='SUBMITTED'`,
      [reservationId],
    );
  }

  async claimLearningAttempt(): Promise<boolean> {
    const dateKey = localDateKey();
    const state = await ensureDayForDate(dateKey);
    if (!state.learningMode) return false;
    const result = await pool.query(
      `UPDATE public.cryptocrawler_operator_strategy_days
       SET learning_last_attempt_at=now(), updated_at=now()
       WHERE local_date=$1::date
         AND eligibility_decided=true
         AND is_trade_day=false
         AND (learning_last_attempt_at IS NULL OR learning_last_attempt_at <= now() - interval '1 hour')
       RETURNING local_date`,
      [dateKey],
    );
    return result.rowCount === 1;
  }

  async runLearningDayCycle(): Promise<void> {
    if (!await this.claimLearningAttempt()) return;
    try {
      const { getCryptara } = await import('../../cryptara/index.js');
      await getCryptara().runMonteCarloSimulation();
      logger.info('[OperatorStrategy] Cryptara learning-day simulation completed', {
        component: 'OperatorTradingStrategy',
        localDate: localDateKey(),
        timezone: STRATEGY_TIMEZONE,
        executionAllowed: false,
      });
    } catch (error) {
      logger.debug('[OperatorStrategy] Learning-day simulation deferred until measured context is sufficient', {
        component: 'OperatorTradingStrategy',
        localDate: localDateKey(),
        error: error instanceof Error ? error.message : String(error),
        syntheticLearningEvidenceUsed: false,
      });
    }
  }
}

export const operatorTradingStrategy = new OperatorTradingStrategy();
export const OPERATOR_STRATEGY_CONSTANTS = Object.freeze({
  timezone: STRATEGY_TIMEZONE,
  cycleDays: CYCLE_DAYS,
  profitDaysTarget: PROFIT_DAYS_TARGET,
  baselineAttemptDaysPerCycle: BASELINE_ATTEMPT_DAYS_PER_CYCLE,
  minDailyTrades: MIN_DAILY_TRADES,
  maxDailyTrades: MAX_DAILY_TRADES,
  minDailyProfitCeilingUsd: MIN_DAILY_PROFIT_CEILING_USD,
  maxDailyProfitCeilingUsd: MAX_DAILY_PROFIT_CEILING_USD,
  profitCushionUsd: PROFIT_CUSHION_USD,
});