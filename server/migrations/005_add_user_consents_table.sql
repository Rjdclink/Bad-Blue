-- Migration: Create user_consents table
-- Date: 2025-12-04
-- Purpose: Track user consent for legal acknowledgments and terms

-- Create user_consents table
CREATE TABLE IF NOT EXISTS user_consents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL,
  plan_id TEXT,
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  signature TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index to prevent duplicate consents
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_payment_consent 
  ON user_consents(user_id, payment_id, consent_version);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_consents_user_id 
  ON user_consents(user_id);

-- Create index on payment_id for payment verification
CREATE INDEX IF NOT EXISTS idx_user_consents_payment_id 
  ON user_consents(payment_id);

-- Create index on created_at for audit queries
CREATE INDEX IF NOT EXISTS idx_user_consents_created_at 
  ON user_consents(created_at DESC);

-- Add check constraint for consent_version format
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_consents_version_format_check'
  ) THEN
    ALTER TABLE user_consents
      ADD CONSTRAINT user_consents_version_format_check 
      CHECK (consent_version ~ '^v[0-9]+\.[0-9]+(\.[0-9]+)?$');
  END IF;
END$$;

-- Add comments for documentation
COMMENT ON TABLE user_consents IS 'User consent records for legal acknowledgments and terms';
COMMENT ON COLUMN user_consents.user_id IS 'Foreign key to users table';
COMMENT ON COLUMN user_consents.payment_id IS 'Payment transaction ID (Square payment ID or subscription ID)';
COMMENT ON COLUMN user_consents.plan_id IS 'Subscription plan ID at time of consent';
COMMENT ON COLUMN user_consents.consent_version IS 'Version of consent text (format: v1.0, v1.1, etc.)';
COMMENT ON COLUMN user_consents.consent_text IS 'Full text of legal acknowledgment that user accepted';
COMMENT ON COLUMN user_consents.ip_address IS 'IP address of user at time of consent';
COMMENT ON COLUMN user_consents.user_agent IS 'Browser user agent string at time of consent';
COMMENT ON COLUMN user_consents.signature IS 'HMAC-SHA256 signature for consent verification';
COMMENT ON COLUMN user_consents.created_at IS 'Timestamp when consent was recorded';
COMMENT ON COLUMN user_consents.updated_at IS 'Timestamp when consent was last updated';

-- Create trigger to update updated_at automatically
CREATE OR REPLACE FUNCTION update_user_consents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_user_consents_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_user_consents_updated_at_trigger
      BEFORE UPDATE ON user_consents
      FOR EACH ROW
      EXECUTE FUNCTION update_user_consents_updated_at();
  END IF;
END$$;

-- Verification queries (run after migration)
-- SELECT * FROM information_schema.tables WHERE table_name = 'user_consents';
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'user_consents'
-- ORDER BY ordinal_position;
