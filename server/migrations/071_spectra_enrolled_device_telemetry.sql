-- Latest authenticated telemetry reported by enrolled Android/Apple devices.
-- This is operational device enrollment/telemetry storage only; SPECTRA does
-- not implement a consent-form workflow.
ALTER TABLE public.spectra_enrolled_devices
  ADD COLUMN IF NOT EXISTS ingest_token_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'spectra_enrolled_devices_ingest_token_hash_check'
      AND conrelid = 'public.spectra_enrolled_devices'::regclass
  ) THEN
    ALTER TABLE public.spectra_enrolled_devices
      ADD CONSTRAINT spectra_enrolled_devices_ingest_token_hash_check
      CHECK (
        ingest_token_hash IS NULL
        OR ingest_token_hash ~ '^[a-f0-9]{64}$'
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.spectra_enrolled_device_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  device_ref text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'other')),
  normalizer_kind text NOT NULL CHECK (length(normalizer_kind) BETWEEN 1 AND 100),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  FOREIGN KEY (user_id, device_ref)
    REFERENCES public.spectra_enrolled_devices(user_id, device_ref)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  UNIQUE (user_id, device_ref, payload_hash)
);

CREATE INDEX IF NOT EXISTS spectra_enrolled_device_telemetry_latest_idx
  ON public.spectra_enrolled_device_telemetry
  (user_id, device_ref, observed_at DESC, received_at DESC);

ALTER TABLE public.spectra_enrolled_device_telemetry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spectra_enrolled_device_telemetry FROM PUBLIC;

DO $$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.spectra_enrolled_device_telemetry FROM %I',
      api_role
    );
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public.spectra_enrolled_device_telemetry TO service_role;
  END IF;
END
$$;
