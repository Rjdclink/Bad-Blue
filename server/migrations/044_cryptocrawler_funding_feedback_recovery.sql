-- Durable terminal-feedback replay for funding lifecycles.
-- Settlement truth is already persisted by migration 024; these columns make
-- Cryptara/learning delivery retryable without changing settlement authority.

ALTER TABLE private.cryptocrawler_funding_lifecycles
  ADD COLUMN IF NOT EXISTS feedback_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_lease_owner text,
  ADD COLUMN IF NOT EXISTS feedback_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS cryptocrawler_funding_lifecycle_feedback_idx
  ON private.cryptocrawler_funding_lifecycles(feedback_applied_at, updated_at)
  WHERE status='closed' AND feedback_applied_at IS NULL;

COMMENT ON COLUMN private.cryptocrawler_funding_lifecycles.feedback_applied_at IS
  'Marks successful delivery of terminal realized funding evidence to Cryptara/learning. Null means settlement is durable but feedback still requires replay.';