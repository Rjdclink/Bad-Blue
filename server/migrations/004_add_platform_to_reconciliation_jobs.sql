-- Migration: Add platform support to reconciliation_jobs
-- Date: 2025-12-04
-- Purpose: Enable platform-aware reconciliation (Square + newplatform)

-- Add platform column (default to 'square' for backward compatibility)
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'square';

-- Add idempotency_key for duplicate prevention
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Add payload column for job-specific data (JSONB for flexibility)
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Add status tracking
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Add retry tracking
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- Add error tracking
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Add processing timestamps
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- Add worker identification
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS worker TEXT;

-- Add completed_at timestamp
ALTER TABLE reconciliation_jobs
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add check constraint for valid status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'reconciliation_jobs_status_check'
  ) THEN
    ALTER TABLE reconciliation_jobs
      ADD CONSTRAINT reconciliation_jobs_status_check 
      CHECK (status IN ('pending', 'processing', 'done', 'failed', 'manual_review'));
  END IF;
END$$;

-- Add check constraint for valid platform values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'reconciliation_jobs_platform_check'
  ) THEN
    ALTER TABLE reconciliation_jobs
      ADD CONSTRAINT reconciliation_jobs_platform_check 
      CHECK (platform IN ('square', 'newplatform'));
  END IF;
END$$;

-- Create performance index on platform + status
CREATE INDEX IF NOT EXISTS idx_reconciliation_platform_status 
  ON reconciliation_jobs(platform, status);

-- Create index on status + created_at for queue processing
CREATE INDEX IF NOT EXISTS idx_reconciliation_status_created 
  ON reconciliation_jobs(status, created_at);

-- Create unique index on platform + idempotency_key for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS ux_reconciliation_platform_idempotency 
  ON reconciliation_jobs(platform, idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

-- Create index on worker for monitoring
CREATE INDEX IF NOT EXISTS idx_reconciliation_worker 
  ON reconciliation_jobs(worker) 
  WHERE worker IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN reconciliation_jobs.platform IS 'Payment platform: square or newplatform';
COMMENT ON COLUMN reconciliation_jobs.idempotency_key IS 'UUID for preventing duplicate job processing';
COMMENT ON COLUMN reconciliation_jobs.payload IS 'Job-specific data (payment IDs, customer IDs, etc.)';
COMMENT ON COLUMN reconciliation_jobs.status IS 'Job status: pending, processing, done, failed, manual_review';
COMMENT ON COLUMN reconciliation_jobs.attempts IS 'Number of processing attempts (for retry logic)';
COMMENT ON COLUMN reconciliation_jobs.last_error IS 'Most recent error message if job failed';
COMMENT ON COLUMN reconciliation_jobs.worker IS 'Hostname/ID of worker that processed the job';

-- Verification queries (run after migration)
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns 
-- WHERE table_name = 'reconciliation_jobs'
-- ORDER BY ordinal_position;

-- SELECT conname, contype, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'reconciliation_jobs'::regclass;
