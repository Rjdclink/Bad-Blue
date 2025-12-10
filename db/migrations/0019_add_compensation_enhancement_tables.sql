-- Hyper-Maximum Cryptocurrency Compensation System
-- Database schema for compensation enhancement layer

-- ============================================================================
-- COMPENSATION STREAMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS compensation_streams (
  id VARCHAR PRIMARY KEY,
  source VARCHAR(50) NOT NULL CHECK (source IN ('computational_grid', 'flash_engine', 'beneficial_crawler', 'tri_beam_broadcast')),
  amount VARCHAR NOT NULL,
  token VARCHAR(20) NOT NULL,
  chain VARCHAR(50) NOT NULL,
  timestamp BIGINT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compensation_streams_source ON compensation_streams(source);
CREATE INDEX IF NOT EXISTS idx_compensation_streams_timestamp ON compensation_streams(timestamp);
CREATE INDEX IF NOT EXISTS idx_compensation_streams_chain ON compensation_streams(chain);

-- ============================================================================
-- PAYOUT CYCLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS payout_cycles (
  id VARCHAR PRIMARY KEY,
  cycle_number INTEGER NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT,
  total_amount VARCHAR NOT NULL,
  target_token VARCHAR(20) NOT NULL,
  target_chain VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'consolidating', 'executing', 'completed', 'failed')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_cycles_cycle_number ON payout_cycles(cycle_number);
CREATE INDEX IF NOT EXISTS idx_payout_cycles_status ON payout_cycles(status);
CREATE INDEX IF NOT EXISTS idx_payout_cycles_start_time ON payout_cycles(start_time);

-- ============================================================================
-- PAYOUT TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS payout_transactions (
  id VARCHAR PRIMARY KEY,
  cycle_id VARCHAR NOT NULL REFERENCES payout_cycles(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  amount VARCHAR NOT NULL,
  token VARCHAR(20) NOT NULL,
  chain VARCHAR(50) NOT NULL,
  tx_hash VARCHAR(66),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
  confirmations INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 1,
  backup_chain VARCHAR(50),
  backup_tx_hash VARCHAR(66),
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_transactions_cycle ON payout_transactions(cycle_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_wallet ON payout_transactions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_status ON payout_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_tx_hash ON payout_transactions(tx_hash);

-- ============================================================================
-- PAYOUT VERIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS payout_verifications (
  id VARCHAR PRIMARY KEY,
  tx_id VARCHAR NOT NULL REFERENCES payout_transactions(id) ON DELETE CASCADE,
  verification_type VARCHAR(20) NOT NULL CHECK (verification_type IN ('onchain', 'checksum', 'receipt', 'explorer')),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at BIGINT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_verifications_tx ON payout_verifications(tx_id);
CREATE INDEX IF NOT EXISTS idx_payout_verifications_type ON payout_verifications(verification_type);
CREATE INDEX IF NOT EXISTS idx_payout_verifications_verified ON payout_verifications(verified);

-- ============================================================================
-- WALLET BINDINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_bindings (
  id VARCHAR PRIMARY KEY,
  address VARCHAR(42) NOT NULL UNIQUE,
  chain_id VARCHAR(50) NOT NULL,
  bound_at BIGINT NOT NULL,
  last_verified BIGINT NOT NULL,
  integrity_checks INTEGER DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_bindings_address ON wallet_bindings(address);
CREATE INDEX IF NOT EXISTS idx_wallet_bindings_chain ON wallet_bindings(chain_id);
CREATE INDEX IF NOT EXISTS idx_wallet_bindings_verified ON wallet_bindings(verified);

-- ============================================================================
-- PROOF OF RECEIPT
-- ============================================================================

CREATE TABLE IF NOT EXISTS proof_of_receipts (
  id VARCHAR PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  expected_amount VARCHAR NOT NULL,
  received_amount VARCHAR NOT NULL,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
  supplemental_payout_id VARCHAR,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proof_of_receipts_tx_hash ON proof_of_receipts(tx_hash);
CREATE INDEX IF NOT EXISTS idx_proof_of_receipts_wallet ON proof_of_receipts(wallet_address);
CREATE INDEX IF NOT EXISTS idx_proof_of_receipts_reconciliation ON proof_of_receipts(reconciliation_required);

-- ============================================================================
-- COMPENSATION ASSURANCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS compensation_assurances (
  id VARCHAR PRIMARY KEY,
  payout_id VARCHAR NOT NULL REFERENCES payout_transactions(id) ON DELETE CASCADE,
  crawler_verifications INTEGER DEFAULT 0,
  redundant_issues INTEGER DEFAULT 1,
  consensus_confirmations INTEGER DEFAULT 0,
  correction_cycles INTEGER DEFAULT 0,
  guaranteed BOOLEAN NOT NULL DEFAULT FALSE,
  guarantee_level VARCHAR(20) NOT NULL CHECK (guarantee_level IN ('basic', 'enhanced', 'absolute')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compensation_assurances_payout ON compensation_assurances(payout_id);
CREATE INDEX IF NOT EXISTS idx_compensation_assurances_guaranteed ON compensation_assurances(guaranteed);
CREATE INDEX IF NOT EXISTS idx_compensation_assurances_level ON compensation_assurances(guarantee_level);

-- ============================================================================
-- FAILURE CORRECTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS failure_corrections (
  id VARCHAR PRIMARY KEY,
  payout_id VARCHAR NOT NULL REFERENCES payout_transactions(id) ON DELETE CASCADE,
  failure_type VARCHAR(20) NOT NULL CHECK (failure_type IN ('network', 'validation', 'execution')),
  correction_action VARCHAR(50) NOT NULL,
  priority VARCHAR(20) NOT NULL CHECK (priority IN ('normal', 'high', 'critical')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failure_corrections_payout ON failure_corrections(payout_id);
CREATE INDEX IF NOT EXISTS idx_failure_corrections_status ON failure_corrections(status);
CREATE INDEX IF NOT EXISTS idx_failure_corrections_priority ON failure_corrections(priority);

-- ============================================================================
-- REVENUE STREAM TASKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS computational_grid_tasks (
  id VARCHAR PRIMARY KEY,
  task_type VARCHAR(10) NOT NULL CHECK (task_type IN ('cpu', 'gpu')),
  cycle_count INTEGER NOT NULL,
  network_id VARCHAR(50) NOT NULL,
  compensation VARCHAR NOT NULL,
  completed_at BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_computational_grid_tasks_type ON computational_grid_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_computational_grid_tasks_network ON computational_grid_tasks(network_id);

CREATE TABLE IF NOT EXISTS flash_engine_profits (
  id VARCHAR PRIMARY KEY,
  profit_type VARCHAR(30) NOT NULL CHECK (profit_type IN ('arbitrage', 'micro_delta', 'liquidity_reshape')),
  amount VARCHAR NOT NULL,
  execution_time INTEGER NOT NULL,
  reversible BOOLEAN NOT NULL DEFAULT FALSE,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flash_engine_profits_type ON flash_engine_profits(profit_type);
CREATE INDEX IF NOT EXISTS idx_flash_engine_profits_timestamp ON flash_engine_profits(timestamp);

CREATE TABLE IF NOT EXISTS crawler_bounties (
  id VARCHAR PRIMARY KEY,
  crawler_id VARCHAR NOT NULL,
  tasks_claimed INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  total_compensation VARCHAR NOT NULL DEFAULT '0',
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawler_bounties_crawler ON crawler_bounties(crawler_id);

CREATE TABLE IF NOT EXISTS tri_beam_revenues (
  id VARCHAR PRIMARY KEY,
  node_id VARCHAR NOT NULL,
  connections INTEGER NOT NULL,
  revenue_generated VARCHAR NOT NULL,
  lattice_position VARCHAR(20),
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tri_beam_revenues_node ON tri_beam_revenues(node_id);
CREATE INDEX IF NOT EXISTS idx_tri_beam_revenues_timestamp ON tri_beam_revenues(timestamp);

-- ============================================================================
-- VIEWS FOR ANALYTICS
-- ============================================================================

-- Total compensation by source
CREATE OR REPLACE VIEW v_compensation_by_source AS
SELECT 
  source,
  COUNT(*) as stream_count,
  SUM(CAST(amount AS DECIMAL)) as total_amount,
  token,
  chain
FROM compensation_streams
GROUP BY source, token, chain;

-- Payout success rate
CREATE OR REPLACE VIEW v_payout_success_rate AS
SELECT 
  COUNT(*) as total_payouts,
  SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as successful_payouts,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_payouts,
  ROUND(
    (SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)::DECIMAL / 
     NULLIF(COUNT(*), 0)) * 100, 
    2
  ) as success_rate_percent
FROM payout_transactions;

-- Compensation guarantee statistics
CREATE OR REPLACE VIEW v_guarantee_statistics AS
SELECT 
  guarantee_level,
  COUNT(*) as count,
  SUM(CASE WHEN guaranteed = true THEN 1 ELSE 0 END) as guaranteed_count,
  AVG(crawler_verifications) as avg_verifications,
  AVG(consensus_confirmations) as avg_confirmations
FROM compensation_assurances
GROUP BY guarantee_level;
