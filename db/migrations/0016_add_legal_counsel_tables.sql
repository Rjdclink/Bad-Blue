-- Migration: Add Legal Counsel system tables
-- Phase 1A: Backend infrastructure for intelligent legal consultation

-- Legal Counsel Sessions table
CREATE TABLE IF NOT EXISTS legal_counsel_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  law_type VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_legal_counsel_sessions_user ON legal_counsel_sessions(user_id);
CREATE INDEX idx_legal_counsel_sessions_law_type ON legal_counsel_sessions(law_type);
CREATE INDEX idx_legal_counsel_sessions_created ON legal_counsel_sessions(created_at);

-- Legal Counsel Messages table
CREATE TABLE IF NOT EXISTS legal_counsel_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL REFERENCES legal_counsel_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  verified BOOLEAN DEFAULT false NOT NULL,
  verification_score INTEGER CHECK (verification_score >= 0 AND verification_score <= 100),
  citations JSONB DEFAULT '[]'::jsonb,
  timestamp TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_legal_counsel_messages_session ON legal_counsel_messages(session_id);
CREATE INDEX idx_legal_counsel_messages_timestamp ON legal_counsel_messages(timestamp);

-- Legal Counsel Suggestions table
CREATE TABLE IF NOT EXISTS legal_counsel_suggestions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL REFERENCES legal_counsel_sessions(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('document', 'people-search', 'evidence-upload', 'next-step')),
  priority VARCHAR(10) NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_legal_counsel_suggestions_session ON legal_counsel_suggestions(session_id);
CREATE INDEX idx_legal_counsel_suggestions_status ON legal_counsel_suggestions(status);
CREATE INDEX idx_legal_counsel_suggestions_priority ON legal_counsel_suggestions(priority);
