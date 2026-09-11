-- Durable scheduling debt for recoverable zero-capital routes. This table does
-- not grant execution authority or preserve stale quotes. It only ensures that a
-- route skipped because of a bounded rescue budget is prioritized when fresh
-- evidence for that route appears again.
CREATE TABLE IF NOT EXISTS public.cryptocrawler_zero_capital_rescue_fairness (
  chain text NOT NULL,
  route_id text NOT NULL,
  route_family text NOT NULL,
  last_opportunity_id text NOT NULL,
  last_net_profit_bps double precision NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  attempt_count bigint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  deferred_count bigint NOT NULL DEFAULT 0 CHECK (deferred_count >= 0),
  PRIMARY KEY (chain, route_id)
);

CREATE INDEX IF NOT EXISTS idx_zero_capital_rescue_fairness_due
  ON public.cryptocrawler_zero_capital_rescue_fairness (
    chain,
    deferred_count DESC,
    last_attempt_at ASC NULLS FIRST,
    first_seen_at ASC
  );

ALTER TABLE public.cryptocrawler_zero_capital_rescue_fairness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_zero_capital_rescue_fairness FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_zero_capital_rescue_fairness TO service_role;

COMMENT ON TABLE public.cryptocrawler_zero_capital_rescue_fairness IS
  'Scheduling-only debt for fresh zero-capital rescue attempts. It stores no executable quote and never changes canonical profitability or execution authority.';
