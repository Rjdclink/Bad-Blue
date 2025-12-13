-- Migration: Add Search Persistence Tables
-- Purpose: Add database persistence for Pantheon OSINT, Inmate Search, and Lexara conversations
-- Date: 2025-12-13
-- Tables: inmate_search_reports, lexara_conversations

-- ============================================
-- INMATE SEARCH REPORTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS inmate_search_reports (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  search_query JSONB NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  state VARCHAR(2),
  report_data JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'processing',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Create indexes for inmate search reports
CREATE INDEX IF NOT EXISTS idx_inmate_search_user ON inmate_search_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_inmate_search_status ON inmate_search_reports(status);
CREATE INDEX IF NOT EXISTS idx_inmate_search_created ON inmate_search_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_inmate_search_name ON inmate_search_reports(last_name, first_name);

-- ============================================
-- LEXARA CONVERSATION HISTORY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS lexara_conversations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(255),
  user_prompt TEXT NOT NULL,
  lexara_response TEXT NOT NULL,
  audio_generated BOOLEAN DEFAULT FALSE,
  audio_url TEXT,
  audio_base64 TEXT,
  audio_duration_ms INTEGER,
  model VARCHAR(50),
  context JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for lexara conversations
CREATE INDEX IF NOT EXISTS idx_lexara_user ON lexara_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_lexara_session ON lexara_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_lexara_created ON lexara_conversations(created_at);

-- Add comments for documentation
COMMENT ON TABLE inmate_search_reports IS 'Stores inmate search history and results for tracking and retrieval';
COMMENT ON TABLE lexara_conversations IS 'Stores Lexara AI conversation history with audio synthesis tracking';

COMMENT ON COLUMN inmate_search_reports.search_query IS 'Full search criteria as JSON';
COMMENT ON COLUMN inmate_search_reports.report_data IS 'Complete search results including all inmates found';
COMMENT ON COLUMN inmate_search_reports.status IS 'Search status: processing, completed, or failed';
COMMENT ON COLUMN inmate_search_reports.completed_at IS 'Timestamp when search completed';

COMMENT ON COLUMN lexara_conversations.session_id IS 'Groups related conversations in a session';
COMMENT ON COLUMN lexara_conversations.audio_generated IS 'Whether TTS audio was successfully generated';
COMMENT ON COLUMN lexara_conversations.audio_base64 IS 'Base64 encoded audio for small files';
COMMENT ON COLUMN lexara_conversations.context IS 'Conversation context and metadata';
