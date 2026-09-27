-- Supabase preview branches start from checked-in Supabase migrations, while the
-- app's canonical users table is normally provisioned by the server's schema
-- setup. Supply that prerequisite for a fresh isolated preview database so the
-- following trial migration can be validated. Existing databases are unchanged.
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
