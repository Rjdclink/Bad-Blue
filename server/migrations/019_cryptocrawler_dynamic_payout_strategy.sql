ALTER TABLE public.cryptocrawler_terminal_sweep_control
  ADD COLUMN IF NOT EXISTS profitable_payout_sequence bigint NOT NULL DEFAULT 0 CHECK (profitable_payout_sequence >= 0),
  ADD COLUMN IF NOT EXISTS last_profit_payout_scheduled_at timestamptz;

ALTER TABLE public.cryptocrawler_profit_payout_jobs
  ADD COLUMN IF NOT EXISTS payout_sequence bigint,
  ADD COLUMN IF NOT EXISTS payout_fraction numeric,
  ADD COLUMN IF NOT EXISTS retained_fraction numeric,
  ADD COLUMN IF NOT EXISTS scheduled_not_before timestamptz,
  ADD COLUMN IF NOT EXISTS source_asset text;

ALTER TABLE public.cryptocrawler_profit_payout_jobs
  DROP CONSTRAINT IF EXISTS cryptocrawler_profit_payout_jobs_fraction_check;
ALTER TABLE public.cryptocrawler_profit_payout_jobs
  ADD CONSTRAINT cryptocrawler_profit_payout_jobs_fraction_check CHECK (
    payout_fraction IS NULL OR (
      payout_fraction >= 0.55 AND payout_fraction <= 0.65 AND
      retained_fraction IS NOT NULL AND
      abs((payout_fraction + retained_fraction) - 1.0) <= 0.000000001
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_profit_payout_sequence
  ON public.cryptocrawler_profit_payout_jobs(payout_sequence)
  WHERE payout_sequence IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_profit_payout_due
  ON public.cryptocrawler_profit_payout_jobs(status, scheduled_not_before, created_at);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_payout_asset_reservations (
  event_id text PRIMARY KEY REFERENCES public.cryptocrawler_profit_payout_jobs(event_id) ON DELETE CASCADE,
  venue text NOT NULL CHECK (venue IN ('coinbase','kraken','okx')),
  asset text NOT NULL,
  reserved_asset_amount numeric NOT NULL CHECK (reserved_asset_amount > 0),
  remaining_asset_amount numeric NOT NULL CHECK (remaining_asset_amount >= 0),
  status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','IN_FLIGHT','RELEASED','TERMINAL_SWEPT','MANUAL_REVIEW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_asset_amount <= reserved_asset_amount + 0.000000001)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_payout_asset_reserve_spendability
  ON public.cryptocrawler_payout_asset_reservations(venue, asset, status)
  WHERE remaining_asset_amount > 0;

ALTER TABLE public.cryptocrawler_payout_asset_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_payout_asset_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_payout_asset_reservations TO service_role;

COMMENT ON COLUMN public.cryptocrawler_profit_payout_jobs.payout_fraction IS
  'Persisted capital-allocation decision. First three profitable settlements use 0.60; later settlements use one bounded 0.55-0.65 strategy draw chosen once and never re-rolled.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_jobs.scheduled_not_before IS
  'Earliest treasury execution time. Scheduling is persisted so retries/restarts never change the original strategy decision.';
COMMENT ON TABLE public.cryptocrawler_payout_asset_reservations IS
  'Payout capital excluded from NEW trade spendability after terminal settlement. It never cancels or preempts an already-reserved live trade; retained capital remains unreserved.';
