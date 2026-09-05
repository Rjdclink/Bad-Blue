-- Provenance-backed native-gas consumption authority for post-profit operations.
-- A wallet's raw native balance is never ownership authority. Spendability comes
-- only from terminal SETTLED native-gas deliveries created from verified
-- SELF_FUNDED CryptoCrawler proceeds, less prior settled/reserved gas spends.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_system_native_gas_spends (
  spend_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  scope text NOT NULL REFERENCES public.zero_capital_capital_state(scope) ON DELETE RESTRICT,
  chain text NOT NULL,
  wallet text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('RESERVED','SUBMITTED','SETTLED','RELEASED','MANUAL_REVIEW')),
  reserved_wei numeric(78,0) NOT NULL CHECK (reserved_wei > 0),
  actual_spent_wei numeric(78,0) CHECK (actual_spent_wei IS NULL OR (actual_spent_wei >= 0 AND actual_spent_wei <= reserved_wei)),
  transaction_hash text,
  settlement_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  submitted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (wallet ~* '^0x[0-9a-f]{40}$'),
  CHECK (transaction_hash IS NULL OR transaction_hash ~* '^0x[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_system_native_gas_spends_tx
  ON public.cryptocrawler_system_native_gas_spends(lower(transaction_hash))
  WHERE transaction_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_system_native_gas_spends_wallet
  ON public.cryptocrawler_system_native_gas_spends(scope, lower(chain), lower(wallet), status);

CREATE OR REPLACE FUNCTION public.cryptocrawler_reserve_system_native_gas_spend(
  p_idempotency_key text,
  p_scope text,
  p_chain text,
  p_wallet text,
  p_purpose text,
  p_max_wei numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing record;
  normalized_chain text := lower(trim(p_chain));
  normalized_wallet text := lower(trim(p_wallet));
  delivered numeric(78,0) := 0;
  committed numeric(78,0) := 0;
  created_id uuid;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key))=0
     OR p_scope IS NULL OR length(trim(p_scope))=0
     OR normalized_chain=''
     OR normalized_wallet !~ '^0x[0-9a-f]{40}$'
     OR p_purpose IS NULL OR length(trim(p_purpose))=0
     OR p_max_wei IS NULL OR p_max_wei <= 0 OR trunc(p_max_wei) <> p_max_wei THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cryptocrawler:native-gas:' || p_scope || ':' || normalized_chain || ':' || normalized_wallet, 0));

  SELECT * INTO existing
  FROM public.cryptocrawler_system_native_gas_spends
  WHERE idempotency_key=trim(p_idempotency_key)
  FOR UPDATE;

  IF existing IS NOT NULL THEN
    IF existing.scope<>p_scope OR lower(existing.chain)<>normalized_chain OR lower(existing.wallet)<>normalized_wallet
       OR existing.purpose<>trim(p_purpose) OR existing.reserved_wei<>p_max_wei THEN
      RAISE EXCEPTION 'system-native-gas idempotency key is bound to different durable intent';
    END IF;
    IF existing.status='RELEASED' THEN RETURN NULL; END IF;
    RETURN existing.spend_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.zero_capital_capital_state
    WHERE scope=p_scope AND lifecycle='SELF_FUNDED'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(delivered_native_wei::numeric),0)
  INTO delivered
  FROM public.zero_capital_native_gas_funding_attempts
  WHERE scope=p_scope
    AND state='SETTLED'
    AND reimbursement_verified=true
    AND lower(destination_chain)=normalized_chain
    AND lower(destination_wallet)=normalized_wallet
    AND delivered_native_wei ~ '^[0-9]+$'
    AND delivered_native_wei::numeric > 0
    AND destination_transaction_hash ~* '^0x[0-9a-f]{64}$';

  SELECT COALESCE(SUM(
    CASE
      WHEN status='SETTLED' THEN COALESCE(actual_spent_wei, reserved_wei)
      WHEN status IN ('RESERVED','SUBMITTED','MANUAL_REVIEW') THEN reserved_wei
      ELSE 0
    END
  ),0)
  INTO committed
  FROM public.cryptocrawler_system_native_gas_spends
  WHERE scope=p_scope
    AND lower(chain)=normalized_chain
    AND lower(wallet)=normalized_wallet;

  IF delivered - committed < p_max_wei THEN RETURN NULL; END IF;

  INSERT INTO public.cryptocrawler_system_native_gas_spends
    (idempotency_key, scope, chain, wallet, purpose, status, reserved_wei)
  VALUES
    (trim(p_idempotency_key), p_scope, normalized_chain, normalized_wallet, trim(p_purpose), 'RESERVED', p_max_wei)
  RETURNING spend_id INTO created_id;

  RETURN created_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_submit_system_native_gas_spend(
  p_spend_id uuid,
  p_transaction_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  row_spend record;
  normalized_hash text := lower(trim(p_transaction_hash));
BEGIN
  IF p_spend_id IS NULL OR normalized_hash !~ '^0x[0-9a-f]{64}$' THEN RETURN false; END IF;
  SELECT * INTO row_spend
  FROM public.cryptocrawler_system_native_gas_spends
  WHERE spend_id=p_spend_id
  FOR UPDATE;
  IF row_spend IS NULL THEN RETURN false; END IF;
  IF row_spend.status IN ('SUBMITTED','SETTLED','MANUAL_REVIEW') THEN
    RETURN lower(COALESCE(row_spend.transaction_hash,''))=normalized_hash;
  END IF;
  IF row_spend.status<>'RESERVED' THEN RETURN false; END IF;
  UPDATE public.cryptocrawler_system_native_gas_spends
  SET status='SUBMITTED', transaction_hash=normalized_hash,
      submitted_at=COALESCE(submitted_at,now()), updated_at=now(), last_error=NULL
  WHERE spend_id=p_spend_id AND status='RESERVED';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_settle_system_native_gas_spend(
  p_spend_id uuid,
  p_transaction_hash text,
  p_actual_spent_wei numeric,
  p_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  row_spend record;
  normalized_hash text := lower(trim(p_transaction_hash));
BEGIN
  IF p_spend_id IS NULL OR normalized_hash !~ '^0x[0-9a-f]{64}$'
     OR p_actual_spent_wei IS NULL OR p_actual_spent_wei < 0 OR trunc(p_actual_spent_wei)<>p_actual_spent_wei THEN
    RETURN false;
  END IF;
  SELECT * INTO row_spend
  FROM public.cryptocrawler_system_native_gas_spends
  WHERE spend_id=p_spend_id
  FOR UPDATE;
  IF row_spend IS NULL THEN RETURN false; END IF;
  IF lower(COALESCE(row_spend.transaction_hash,''))<>normalized_hash THEN RETURN false; END IF;
  IF p_actual_spent_wei > row_spend.reserved_wei THEN
    UPDATE public.cryptocrawler_system_native_gas_spends
    SET status='MANUAL_REVIEW', last_error='receipt gas spend exceeded provenance-backed reserved ceiling',
        settlement_evidence=COALESCE(p_evidence,'{}'::jsonb), updated_at=now()
    WHERE spend_id=p_spend_id AND status<>'SETTLED';
    RETURN false;
  END IF;
  IF row_spend.status='SETTLED' THEN
    RETURN row_spend.actual_spent_wei=p_actual_spent_wei;
  END IF;
  IF row_spend.status NOT IN ('SUBMITTED','MANUAL_REVIEW') THEN RETURN false; END IF;
  UPDATE public.cryptocrawler_system_native_gas_spends
  SET status='SETTLED', actual_spent_wei=p_actual_spent_wei,
      settlement_evidence=COALESCE(p_evidence,'{}'::jsonb), settled_at=COALESCE(settled_at,now()),
      updated_at=now(), last_error=NULL
  WHERE spend_id=p_spend_id AND status IN ('SUBMITTED','MANUAL_REVIEW');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_release_system_native_gas_spend(p_spend_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.cryptocrawler_system_native_gas_spends
  SET status='RELEASED', updated_at=now(), last_error=NULL
  WHERE spend_id=p_spend_id AND status='RESERVED' AND transaction_hash IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_mark_system_native_gas_spend_manual_review(
  p_spend_id uuid,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.cryptocrawler_system_native_gas_spends
  SET status='MANUAL_REVIEW', last_error=left(COALESCE(p_error,'native gas submission requires reconciliation'),1000), updated_at=now()
  WHERE spend_id=p_spend_id AND status='SUBMITTED';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON TABLE public.cryptocrawler_system_native_gas_spends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cryptocrawler_system_native_gas_spends TO service_role;
REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_system_native_gas_spend(text,text,text,text,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_submit_system_native_gas_spend(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_settle_system_native_gas_spend(uuid,text,numeric,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_release_system_native_gas_spend(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_mark_system_native_gas_spend_manual_review(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_system_native_gas_spend(text,text,text,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_submit_system_native_gas_spend(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_settle_system_native_gas_spend(uuid,text,numeric,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_system_native_gas_spend(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_mark_system_native_gas_spend_manual_review(uuid,text) TO service_role;

ALTER TABLE public.cryptocrawler_system_native_gas_spends ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.cryptocrawler_system_native_gas_spends IS
  'Exactly-once consumption ledger for CryptoCrawler-owned native gas. Raw wallet native balance is reconciliation evidence only and never grants spend authority.';
COMMENT ON FUNCTION public.cryptocrawler_reserve_system_native_gas_spend(text,text,text,text,text,numeric) IS
  'Reserves only native gas previously delivered within the same SELF_FUNDED scope by terminal SETTLED, reimbursement-verified system-funded gas attempts, net of that scope''s prior settled or unresolved spend reservations.';