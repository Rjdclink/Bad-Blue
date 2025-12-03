-- Stage 2A: Evidence Files Table for Media Upload System
-- Created: 2024-12-03
-- Purpose: Store uploaded evidence/media files with law type associations

CREATE TABLE IF NOT EXISTS evidence_files (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL,
  law_type TEXT,
  associated_with VARCHAR(20) CHECK (associated_with IN ('consultation', 'document')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_evidence_user ON evidence_files(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_law_type ON evidence_files(law_type);

-- Add comment to table for documentation
COMMENT ON TABLE evidence_files IS 'Stage 2A: Stores uploaded evidence and media files with law type associations';
COMMENT ON COLUMN evidence_files.law_type IS 'References law type IDs from shared/lawTypes.ts (e.g., law-enforcement-accountability, criminal-law)';
COMMENT ON COLUMN evidence_files.associated_with IS 'Context where file is used: consultation (LegalAI) or document (document creator)';
COMMENT ON COLUMN evidence_files.storage_path IS 'Path to file in storage system (filesystem or Google Cloud Storage)';
