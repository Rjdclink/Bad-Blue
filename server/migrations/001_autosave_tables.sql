-- ==================== USER WORK SESSIONS ====================
CREATE TABLE IF NOT EXISTS user_work_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  law_type VARCHAR NOT NULL,
  session_type VARCHAR NOT NULL,
  current_step VARCHAR,
  progress_percentage INTEGER DEFAULT 0,
  is_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_accessed_at TIMESTAMP DEFAULT NOW(),
  last_autosave_at TIMESTAMP,
  completed_at TIMESTAMP,
  title VARCHAR,
  description TEXT,
  CONSTRAINT valid_progress CHECK (progress_percentage >= 0 AND progress_percentage <= 100)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active 
ON user_work_sessions(user_id, is_complete, last_accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_sessions_law_type 
ON user_work_sessions(law_type, session_type);

-- ==================== AUTOSAVE SNAPSHOTS ====================
CREATE TABLE IF NOT EXISTS autosave_snapshots (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL REFERENCES user_work_sessions(id) ON DELETE CASCADE,
  snapshot_data JSONB NOT NULL,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  fields_changed TEXT[],
  change_summary TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  user_agent VARCHAR,
  ip_address INET
);

CREATE INDEX IF NOT EXISTS idx_snapshots_session 
ON autosave_snapshots(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_version 
ON autosave_snapshots(session_id, snapshot_version DESC);

-- ==================== CONSULTATION HISTORY ====================
CREATE TABLE IF NOT EXISTS consultation_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL REFERENCES user_work_sessions(id) ON DELETE CASCADE,
  role VARCHAR NOT NULL,
  message TEXT NOT NULL,
  law_type VARCHAR NOT NULL,
  extracted_data JSONB,
  ai_provider VARCHAR,
  tokens_used INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_consultation_session 
ON consultation_history(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_consultation_law_type 
ON consultation_history(law_type);

-- ==================== DOCUMENT DRAFTS ====================
CREATE TABLE IF NOT EXISTS document_drafts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL REFERENCES user_work_sessions(id) ON DELETE CASCADE,
  document_type VARCHAR NOT NULL,
  law_type VARCHAR NOT NULL,
  draft_content TEXT,
  version_number INTEGER DEFAULT 1,
  is_latest BOOLEAN DEFAULT TRUE,
  generated_by VARCHAR,
  ai_provider VARCHAR,
  generation_prompt TEXT,
  status VARCHAR DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN ('draft', 'under-review', 'finalized'))
);

CREATE INDEX IF NOT EXISTS idx_drafts_session_latest 
ON document_drafts(session_id, is_latest);

CREATE INDEX IF NOT EXISTS idx_drafts_law_type 
ON document_drafts(law_type, document_type);

-- ==================== LAW TYPE DEFINITIONS ====================
CREATE TABLE IF NOT EXISTS law_type_definitions (
  id VARCHAR PRIMARY KEY,
  display_name VARCHAR NOT NULL,
  description TEXT,
  icon VARCHAR,
  enabled BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  consultation_system_prompt TEXT,
  document_generation_prompt_template TEXT,
  supports_consultation BOOLEAN DEFAULT TRUE,
  supports_document_creation BOOLEAN DEFAULT TRUE,
  requires_officer_search BOOLEAN DEFAULT FALSE,
  redirect_url VARCHAR,
  uses_legacy_workflow BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_law_types_enabled_sort 
ON law_type_definitions(enabled, sort_order);
