-- LegalWhat authentication-store billing tables, deployed October 13, 2026.
-- Mirrors the production Supabase migration legalwhat_auth_billing_tables_20261013.
-- Server-only billing reconciliation. Never grants paid access or updates users.

CREATE TABLE IF NOT EXISTS public.plans (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  currency varchar(8) NOT NULL DEFAULT 'USD',
  "interval" varchar(16) NOT NULL DEFAULT 'monthly',
  square_plan_id text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id integer NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL,
  square_subscription_id text,
  start_date timestamp without time zone,
  renewal_date timestamp without time zone,
  canceled_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legalwhat_plans_square_plan_id
  ON public.plans (square_plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON public.subscriptions (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legalwhat_subscriptions_square_id
  ON public.subscriptions (square_subscription_id)
  WHERE square_subscription_id IS NOT NULL;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.plans, public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plans, public.subscriptions TO service_role;
REVOKE ALL ON SEQUENCE public.plans_id_seq, public.subscriptions_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.plans_id_seq, public.subscriptions_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
