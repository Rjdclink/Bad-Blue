-- Supabase preview branches run the checked-in Supabase migration history, while
-- the app's users table is otherwise provisioned by server schema setup. Create
-- a compatible base only for a fresh preview database; never alter an existing
-- users table. Keep the preview bootstrap table private by default.
DO $legalwhat_preview_users_baseline$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    CREATE TABLE public.users (
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

    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.users FROM PUBLIC;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON TABLE public.users FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON TABLE public.users FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT ALL ON TABLE public.users TO service_role';
    END IF;
  END IF;
END
$legalwhat_preview_users_baseline$;
