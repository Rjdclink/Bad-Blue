-- Adaptive 30-day operator schedule.
-- Governing rule: 20 is a target of terminal net-profitable DAYS, not a count of
-- preselected calendar days. A stable random priority across all 30 dates supplies
-- the initial 20 preferred attempt dates and the 10 reserve dates. Runtime may
-- promote reserve dates only to keep the target reachable; canonical profitability
-- remains the sole authority over whether any trade may execute.

ALTER TABLE public.cryptocrawler_operator_strategy_cycles
  ADD COLUMN IF NOT EXISTS profit_day_target smallint NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS attempt_priority_offsets smallint[];

UPDATE public.cryptocrawler_operator_strategy_cycles c
SET attempt_priority_offsets = (
  SELECT array_agg(day_offset ORDER BY
    CASE WHEN day_offset = ANY(c.trade_day_offsets) THEN 0 ELSE 1 END,
    md5(c.cycle_start::text || ':' || day_offset::text)
  )
  FROM generate_series(0, 29) AS day_offset
)
WHERE attempt_priority_offsets IS NULL;

ALTER TABLE public.cryptocrawler_operator_strategy_cycles
  ALTER COLUMN attempt_priority_offsets SET NOT NULL;

ALTER TABLE public.cryptocrawler_operator_strategy_cycles
  DROP CONSTRAINT IF EXISTS cryptocrawler_operator_strategy_cycles_profit_day_target_check,
  ADD CONSTRAINT cryptocrawler_operator_strategy_cycles_profit_day_target_check
    CHECK (profit_day_target = 20),
  DROP CONSTRAINT IF EXISTS cryptocrawler_operator_strategy_cycles_attempt_priority_check,
  ADD CONSTRAINT cryptocrawler_operator_strategy_cycles_attempt_priority_check
    CHECK (cardinality(attempt_priority_offsets) = 30);

ALTER TABLE public.cryptocrawler_operator_strategy_days
  ADD COLUMN IF NOT EXISTS preferred_attempt_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promoted_attempt_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terminal_net_profit_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_terminal_trades integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_qualified boolean NOT NULL DEFAULT false;

UPDATE public.cryptocrawler_operator_strategy_days d
SET preferred_attempt_day = d.day_offset = ANY(c.trade_day_offsets),
    promoted_attempt_day = false
FROM public.cryptocrawler_operator_strategy_cycles c
WHERE c.cycle_start=d.cycle_start;

ALTER TABLE public.cryptocrawler_operator_strategy_days
  DROP CONSTRAINT IF EXISTS cryptocrawler_operator_strategy_days_confirmed_terminal_trades_check,
  ADD CONSTRAINT cryptocrawler_operator_strategy_days_confirmed_terminal_trades_check
    CHECK (confirmed_terminal_trades >= 0);

ALTER TABLE public.cryptocrawler_operator_trade_reservations
  ADD COLUMN IF NOT EXISTS terminal_settlement_confirmed boolean,
  ADD COLUMN IF NOT EXISTS terminal_realized_net_profit_usd numeric,
  ADD COLUMN IF NOT EXISTS terminal_accounted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_operator_profit_day_cycle
  ON public.cryptocrawler_operator_strategy_days(cycle_start, profit_qualified, local_date);

COMMENT ON COLUMN public.cryptocrawler_operator_strategy_cycles.attempt_priority_offsets IS
  'Durable random permutation of day offsets 0-29. The first 20 are preferred attempt dates; reserve dates may be promoted adaptively when earlier attempts do not create profit-qualified days.';
COMMENT ON COLUMN public.cryptocrawler_operator_strategy_days.profit_qualified IS
  'True only while confirmed terminal all-in net P&L recorded for this local America/Chicago day is positive. It is the only day-level input that counts toward the 20-profit-day target.';
COMMENT ON COLUMN public.cryptocrawler_operator_strategy_days.promoted_attempt_day IS
  'True when a date outside the initial randomized top-20 priority set is activated to preserve the best attainable path toward 20 profitable days. Promotion never bypasses canonical trade profitability.';
COMMENT ON COLUMN public.cryptocrawler_operator_trade_reservations.terminal_accounted_at IS
  'Set exactly once when confirmed terminal all-in net P&L is applied to the operator day ledger; prevents duplicate day-P&L accounting during reconciliation/replay.';
