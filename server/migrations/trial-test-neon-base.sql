-- Minimal empty-database baseline for the isolated LegalWhat trial/Square test.
-- This is not a production migration. It creates only the auth, session, and
-- subscription tables used by the trial and verified-payment test paths.

CREATE TABLE IF NOT EXISTS public.users (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email varchar UNIQUE,
  first_name varchar,
  last_name varchar,
  profile_image_url varchar,
  status varchar(50) NOT NULL DEFAULT 'pending_payment',
  square_customer_id varchar,
  has_paid_for_access boolean NOT NULL DEFAULT false,
  access_payment_id varchar,
  access_paid_at timestamp,
  last_login_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

CREATE TABLE IF NOT EXISTS public.auth_accounts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auth_type varchar(20) NOT NULL,
  username varchar UNIQUE,
  password_hash text,
  password_salt text,
  last_login_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  sid varchar PRIMARY KEY,
  sess jsonb NOT NULL,
  expire timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public.sessions(expire);

CREATE TABLE IF NOT EXISTS public.plans (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  price integer NOT NULL,
  currency varchar(8) NOT NULL DEFAULT 'USD',
  interval varchar(16) NOT NULL DEFAULT 'monthly',
  square_plan_id text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id integer NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL,
  square_subscription_id text,
  start_date timestamp,
  renewal_date timestamp,
  canceled_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);