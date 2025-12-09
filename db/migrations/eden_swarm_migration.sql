-- Eden Database Migration
-- Creates all tables for the Ultimate Hyper-Evolving Swarm Strategy

-- ============================================
-- EDEN LESSONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_lessons (
  id VARCHAR PRIMARY KEY,
  cain_id VARCHAR NOT NULL,
  opportunity_signature TEXT NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure', 'partial')),
  profit_actual REAL NOT NULL,
  profit_estimated REAL NOT NULL,
  latency INTEGER NOT NULL,
  gas_used INTEGER NOT NULL,
  failure_mode TEXT,
  chain VARCHAR(20) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_lessons_cain ON eden_lessons(cain_id);
CREATE INDEX IF NOT EXISTS idx_eden_lessons_chain ON eden_lessons(chain);
CREATE INDEX IF NOT EXISTS idx_eden_lessons_outcome ON eden_lessons(outcome);
CREATE INDEX IF NOT EXISTS idx_eden_lessons_timestamp ON eden_lessons(timestamp);

-- ============================================
-- EDEN STRATEGY TEMPLATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_strategy_templates (
  id VARCHAR PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  profitability_score REAL NOT NULL,
  success_rate REAL NOT NULL,
  avg_latency INTEGER NOT NULL,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  last_updated TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_strategy_profitability ON eden_strategy_templates(profitability_score);
CREATE INDEX IF NOT EXISTS idx_eden_strategy_success_rate ON eden_strategy_templates(success_rate);

-- ============================================
-- EDEN CAIN STATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_cain_states (
  id VARCHAR PRIMARY KEY,
  type VARCHAR(50) NOT NULL CHECK (type IN ('original', 'cataclysm_detection', 'genesis_reaper')),
  status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'eden_return', 'genesis_cycle', 'doomsday', 'inactive')),
  cycle_count INTEGER NOT NULL DEFAULT 0,
  lessons_collected INTEGER NOT NULL DEFAULT 0,
  last_eden_return TIMESTAMP NOT NULL,
  current_mission TEXT,
  replicas JSONB NOT NULL DEFAULT '[]',
  knowledge JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_cain_type ON eden_cain_states(type);
CREATE INDEX IF NOT EXISTS idx_eden_cain_status ON eden_cain_states(status);

-- ============================================
-- EDEN MICRO CRAWLER STATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_micro_crawler_states (
  id VARCHAR PRIMARY KEY,
  parent_cain_id VARCHAR NOT NULL,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('micro', 'full')),
  priority REAL NOT NULL,
  target VARCHAR(100),
  chain VARCHAR(20),
  status VARCHAR(50) NOT NULL CHECK (status IN ('idle', 'scanning', 'executing', 'shrinking', 'growing')),
  last_activity TIMESTAMP NOT NULL,
  profit_generated REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_micro_parent ON eden_micro_crawler_states(parent_cain_id);
CREATE INDEX IF NOT EXISTS idx_eden_micro_mode ON eden_micro_crawler_states(mode);
CREATE INDEX IF NOT EXISTS idx_eden_micro_status ON eden_micro_crawler_states(status);

-- ============================================
-- EDEN SNAPSHOTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_snapshots (
  id VARCHAR PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  cain_states JSONB NOT NULL,
  strategy_templates JSONB NOT NULL,
  global_metrics JSONB NOT NULL,
  lessons_learned JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_snapshots_timestamp ON eden_snapshots(timestamp);

-- ============================================
-- EDEN CATACLYSM EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_cataclysms (
  id VARCHAR PRIMARY KEY,
  type VARCHAR(50) NOT NULL CHECK (type IN ('market_crash', 'network_congestion', 'exploit_detected', 'oracle_failure', 'system_overload')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  chain VARCHAR(20),
  timestamp TIMESTAMP NOT NULL,
  description TEXT NOT NULL,
  recovery_actions JSONB NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('detected', 'recovering', 'resolved')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_cataclysm_type ON eden_cataclysms(type);
CREATE INDEX IF NOT EXISTS idx_eden_cataclysm_severity ON eden_cataclysms(severity);
CREATE INDEX IF NOT EXISTS idx_eden_cataclysm_status ON eden_cataclysms(status);

-- ============================================
-- EDEN OPPORTUNITY EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_opportunities (
  id VARCHAR PRIMARY KEY,
  type VARCHAR(50) NOT NULL CHECK (type IN ('arbitrage', 'flash_loan', 'liquidation', 'mev', 'price_anomaly')),
  chain VARCHAR(20) NOT NULL,
  priority REAL NOT NULL,
  profit_estimate REAL NOT NULL,
  confidence_score REAL NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  metadata JSONB NOT NULL,
  claimed_by VARCHAR,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'executed', 'expired')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_opp_type ON eden_opportunities(type);
CREATE INDEX IF NOT EXISTS idx_eden_opp_chain ON eden_opportunities(chain);
CREATE INDEX IF NOT EXISTS idx_eden_opp_priority ON eden_opportunities(priority);
CREATE INDEX IF NOT EXISTS idx_eden_opp_status ON eden_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_eden_opp_expires ON eden_opportunities(expires_at);

-- ============================================
-- EDEN AUDIT LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS eden_audit_log (
  id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  ethical_guard_checks JSONB,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eden_audit_agent ON eden_audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_eden_audit_action ON eden_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_eden_audit_timestamp ON eden_audit_log(timestamp);

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE eden_lessons IS 'Lesson packets collected by Cain crawlers during Genesis cycles';
COMMENT ON TABLE eden_strategy_templates IS 'Evolved strategy templates based on lessons learned';
COMMENT ON TABLE eden_cain_states IS 'State of all 10 Cain super-crawlers';
COMMENT ON TABLE eden_micro_crawler_states IS 'State of all micro-crawlers (millions)';
COMMENT ON TABLE eden_snapshots IS 'Complete system snapshots before reset/cataclysm events';
COMMENT ON TABLE eden_cataclysms IS 'Critical events detected by Cataclysm Detection Cains';
COMMENT ON TABLE eden_opportunities IS 'High-probability opportunities detected by Probability Monitoring Cains';
COMMENT ON TABLE eden_audit_log IS 'Auditable ledger of all agent actions and ethical guard checks';
