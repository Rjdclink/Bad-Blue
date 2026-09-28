-- LegalWhat's single canonical, account-backed 72-hour trial grant.
-- Apply this to the database used by the selected local-auth backend before
-- enabling trial signup. This file is intentionally not applied at startup.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS trial_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_consumed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.legalwhat_trial_entitlements (
  user_id varchar PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
  trial_started_at timestamptz NOT NULL,
  trial_expires_at timestamptz NOT NULL,
  trial_consumed_at timestamptz NOT NULL,
  square_customer_id varchar,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT legalwhat_trial_duration_exactly_72h
    CHECK (trial_expires_at = trial_started_at + interval '259200 seconds')
);

CREATE UNIQUE INDEX IF NOT EXISTS legalwhat_trial_square_customer_unique
  ON public.legalwhat_trial_entitlements(square_customer_id)
  WHERE square_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.legalwhat_trial_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  outcome varchar(24) NOT NULL CHECK (outcome IN ('ELIGIBLE', 'CLEAR_REPEAT', 'AMBIGUOUS')),
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS legalwhat_trial_attempts_user_time_idx
  ON public.legalwhat_trial_attempts(user_id, attempted_at DESC);

ALTER TABLE public.legalwhat_trial_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legalwhat_trial_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legalwhat_trial_entitlements FROM PUBLIC;
REVOKE ALL ON public.legalwhat_trial_attempts FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.legalwhat_activate_trial(p_user_id varchar)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
  v_entitlement public.legalwhat_trial_entitlements%ROWTYPE;
  v_now timestamptz;
  v_outcome varchar(24);
BEGIN
  SELECT * INTO v_user
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trial account was not found';
  END IF;

  SELECT * INTO v_entitlement
  FROM public.legalwhat_trial_entitlements
  WHERE user_id = p_user_id;

  IF FOUND THEN
    v_outcome := CASE
      WHEN v_entitlement.trial_expires_at > clock_timestamp() THEN 'ELIGIBLE'
      ELSE 'CLEAR_REPEAT'
    END;
    INSERT INTO public.legalwhat_trial_attempts(user_id, outcome) VALUES (p_user_id, v_outcome);
    RETURN jsonb_build_object(
      'outcome', v_outcome,
      'trialStartedAt', v_entitlement.trial_started_at,
      'trialExpiresAt', v_entitlement.trial_expires_at,
      'trialConsumedAt', v_entitlement.trial_consumed_at
    );
  END IF;

  IF NOT COALESCE(v_user.trial_eligible, false)
     OR lower(COALESCE(v_user.status, '')) = 'suspended' THEN
    v_outcome := 'AMBIGUOUS';
    INSERT INTO public.legalwhat_trial_attempts(user_id, outcome) VALUES (p_user_id, v_outcome);
    RETURN jsonb_build_object('outcome', v_outcome);
  END IF;

  IF NULLIF(btrim(v_user.square_customer_id), '') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.legalwhat_trial_entitlements prior
       WHERE prior.square_customer_id = v_user.square_customer_id
         AND prior.user_id <> p_user_id
     ) THEN
    v_outcome := 'CLEAR_REPEAT';
    INSERT INTO public.legalwhat_trial_attempts(user_id, outcome) VALUES (p_user_id, v_outcome);
    RETURN jsonb_build_object('outcome', v_outcome);
  END IF;

  v_now := clock_timestamp();
  BEGIN
    INSERT INTO public.legalwhat_trial_entitlements(
      user_id, trial_started_at, trial_expires_at, trial_consumed_at, square_customer_id
    )
    VALUES (
      p_user_id, v_now, v_now + interval '259200 seconds', v_now,
      NULLIF(btrim(v_user.square_customer_id), '')
    )
    RETURNING * INTO v_entitlement;
  EXCEPTION WHEN unique_violation THEN
    -- The partial unique Square-customer index serializes simultaneous grants
    -- when a verified customer identity is already consumed by another account.
    v_outcome := 'CLEAR_REPEAT';
    INSERT INTO public.legalwhat_trial_attempts(user_id, outcome) VALUES (p_user_id, v_outcome);
    RETURN jsonb_build_object('outcome', v_outcome);
  END;

  UPDATE public.users
  SET trial_started_at = v_entitlement.trial_started_at,
      trial_expires_at = v_entitlement.trial_expires_at,
      trial_consumed_at = v_entitlement.trial_consumed_at,
      updated_at = clock_timestamp()
  WHERE id = p_user_id;

  v_outcome := 'ELIGIBLE';
  INSERT INTO public.legalwhat_trial_attempts(user_id, outcome) VALUES (p_user_id, v_outcome);
  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'trialStartedAt', v_entitlement.trial_started_at,
    'trialExpiresAt', v_entitlement.trial_expires_at,
    'trialConsumedAt', v_entitlement.trial_consumed_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.legalwhat_bind_trial_square_customer(
  p_user_id varchar,
  p_square_customer_id varchar
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_linked boolean := false;
BEGIN
  IF NULLIF(btrim(p_square_customer_id), '') IS NULL THEN
    RAISE EXCEPTION 'Verified Square customer ID is required';
  END IF;

  BEGIN
    UPDATE public.legalwhat_trial_entitlements
    SET square_customer_id = p_square_customer_id
    WHERE user_id = p_user_id
      AND (square_customer_id IS NULL OR square_customer_id = p_square_customer_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.legalwhat_trial_entitlements prior
        WHERE prior.square_customer_id = p_square_customer_id
          AND prior.user_id <> p_user_id
      );

    v_linked := FOUND;
    RETURN v_linked;
  EXCEPTION WHEN unique_violation THEN
    -- The unique index is the final arbiter if simultaneous bindings both pass
    -- the NOT EXISTS check. Treat the losing bind as a repeat, not a payment error.
    RETURN false;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.legalwhat_trial_schema_ready()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT true;
$function$;

REVOKE ALL ON FUNCTION public.legalwhat_activate_trial(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legalwhat_bind_trial_square_customer(varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legalwhat_trial_schema_ready() FROM PUBLIC;

-- Supabase defines anon/authenticated/service_role; a plain Neon test database
-- may not. Keep this migration portable without weakening its default-deny
-- permissions when those optional roles are absent.
DO $trial_role_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.legalwhat_trial_entitlements FROM anon';
    EXECUTE 'REVOKE ALL ON public.legalwhat_trial_attempts FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.legalwhat_activate_trial(varchar) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.legalwhat_bind_trial_square_customer(varchar, varchar) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.legalwhat_trial_schema_ready() FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.legalwhat_trial_entitlements FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.legalwhat_trial_attempts FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.legalwhat_activate_trial(varchar) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.legalwhat_bind_trial_square_customer(varchar, varchar) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.legalwhat_trial_schema_ready() FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.legalwhat_activate_trial(varchar) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.legalwhat_bind_trial_square_customer(varchar, varchar) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.legalwhat_trial_schema_ready() TO service_role';
  END IF;
END
$trial_role_grants$;