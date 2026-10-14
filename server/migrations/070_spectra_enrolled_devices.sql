-- Operational enrollment registry for SPECTRA active telemetry routing.
-- Authorization/consent workflow is intentionally outside SPECTRA. This table
-- only binds an already-enrolled phone number to its stable device reference
-- and optional upstream tracker identifiers.
CREATE TABLE IF NOT EXISTS public.spectra_enrolled_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'),
  device_ref text NOT NULL CHECK (length(device_ref) BETWEEN 1 AND 300),
  platform text NOT NULL DEFAULT 'other'
    CHECK (platform IN ('android', 'ios', 'other')),
  subject_label text,
  owntracks_user text,
  owntracks_device text,
  traccar_device_id bigint CHECK (traccar_device_id IS NULL OR traccar_device_id > 0),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone_e164),
  UNIQUE (user_id, device_ref)
);

CREATE INDEX IF NOT EXISTS spectra_enrolled_devices_phone_idx
  ON public.spectra_enrolled_devices (user_id, phone_e164)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS spectra_enrolled_devices_ref_idx
  ON public.spectra_enrolled_devices (user_id, device_ref)
  WHERE active = true;

ALTER TABLE public.spectra_enrolled_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spectra_enrolled_devices FROM PUBLIC;

DO $$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.spectra_enrolled_devices FROM %I',
      api_role
    );
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public.spectra_enrolled_devices TO service_role;
  END IF;
END
$$;
