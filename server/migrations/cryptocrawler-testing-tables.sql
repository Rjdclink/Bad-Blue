-- Cryptocrawler Testing Tables Migration
-- Tables for storing simulation states, test results, and crawler evolution data
-- Run this migration to enable full Supabase persistence for the test suite

-- ============================================
-- SIMULATION STATES TABLE
-- Stores real-time simulation state including Monte Carlo progress,
-- capital-free operation state, probabilities, and learned parameters
-- ============================================
CREATE TABLE IF NOT EXISTS cryptocrawler_simulation_states (
  id VARCHAR(255) PRIMARY KEY,
  test_run_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  phase VARCHAR(50) NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  performance_level VARCHAR(20) NOT NULL,
  monte_carlo_state JSONB NOT NULL DEFAULT '{}',
  capital_free_state JSONB NOT NULL DEFAULT '{}',
  probabilities JSONB NOT NULL DEFAULT '{}',
  decisions JSONB NOT NULL DEFAULT '{}',
  learned_parameters JSONB NOT NULL DEFAULT '{}',
  evolutions JSONB NOT NULL DEFAULT '[]',
  resource_usage JSONB NOT NULL DEFAULT '{}',
  is_final BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_sim_states_test_run ON cryptocrawler_simulation_states(test_run_id);
CREATE INDEX IF NOT EXISTS idx_sim_states_timestamp ON cryptocrawler_simulation_states(timestamp);
CREATE INDEX IF NOT EXISTS idx_sim_states_phase ON cryptocrawler_simulation_states(phase);
CREATE INDEX IF NOT EXISTS idx_sim_states_level ON cryptocrawler_simulation_states(performance_level);

-- ============================================
-- TEST RESULTS TABLE
-- Stores final test results with summary statistics,
-- level-specific results, and recommendations
-- ============================================
CREATE TABLE IF NOT EXISTS cryptocrawler_test_results (
  id VARCHAR(255) PRIMARY KEY,
  test_run_id VARCHAR(255) NOT NULL UNIQUE,
  timestamp TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}',
  level_results JSONB NOT NULL DEFAULT '{}',
  errors JSONB NOT NULL DEFAULT '[]',
  warnings JSONB NOT NULL DEFAULT '[]',
  recommendations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_test_results_status ON cryptocrawler_test_results(status);
CREATE INDEX IF NOT EXISTS idx_test_results_timestamp ON cryptocrawler_test_results(timestamp);

-- ============================================
-- LEVEL RESULTS TABLE
-- Stores per-level results with learned parameters and evolutions
-- Used for tracking crawler learning across different market conditions
-- ============================================
CREATE TABLE IF NOT EXISTS cryptocrawler_level_results (
  id VARCHAR(255) PRIMARY KEY,
  test_run_id VARCHAR(255) NOT NULL,
  performance_level VARCHAR(20) NOT NULL,
  learned_parameters JSONB NOT NULL DEFAULT '{}',
  evolutions JSONB NOT NULL DEFAULT '[]',
  capital_free_state JSONB NOT NULL DEFAULT '{}',
  probabilities JSONB NOT NULL DEFAULT '{}',
  final_fitness REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_level_results_test_run ON cryptocrawler_level_results(test_run_id);
CREATE INDEX IF NOT EXISTS idx_level_results_level ON cryptocrawler_level_results(performance_level);
CREATE INDEX IF NOT EXISTS idx_level_results_fitness ON cryptocrawler_level_results(final_fitness);

-- ============================================
-- CRAWLER EVOLUTIONS TABLE
-- Tracks individual crawler evolution history
-- Used for analyzing how crawlers learn and adapt over time
-- ============================================
CREATE TABLE IF NOT EXISTS cryptocrawler_evolutions (
  id VARCHAR(255) PRIMARY KEY,
  test_run_id VARCHAR(255) NOT NULL,
  performance_level VARCHAR(20) NOT NULL,
  generation INTEGER NOT NULL,
  fitness REAL NOT NULL,
  mutations JSONB NOT NULL DEFAULT '[]',
  parent_strategy VARCHAR(255),
  survivor_strategy VARCHAR(255),
  improvement_percent REAL NOT NULL DEFAULT 0,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_evolutions_test_run ON cryptocrawler_evolutions(test_run_id);
CREATE INDEX IF NOT EXISTS idx_evolutions_level ON cryptocrawler_evolutions(performance_level);
CREATE INDEX IF NOT EXISTS idx_evolutions_generation ON cryptocrawler_evolutions(generation);
CREATE INDEX IF NOT EXISTS idx_evolutions_fitness ON cryptocrawler_evolutions(fitness);

-- ============================================
-- CAPITAL-FREE OPERATIONS LOG
-- Tracks all capital-free operations (flash loans, P2P, barter)
-- Used for analyzing the effectiveness of zero-capital strategies
-- ============================================
CREATE TABLE IF NOT EXISTS cryptocrawler_capital_free_ops (
  id VARCHAR(255) PRIMARY KEY,
  test_run_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  operation_type VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL,
  profit_impact REAL NOT NULL DEFAULT 0,
  provider VARCHAR(100),
  performance_level VARCHAR(20),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cf_ops_test_run ON cryptocrawler_capital_free_ops(test_run_id);
CREATE INDEX IF NOT EXISTS idx_cf_ops_type ON cryptocrawler_capital_free_ops(operation_type);
CREATE INDEX IF NOT EXISTS idx_cf_ops_success ON cryptocrawler_capital_free_ops(success);
CREATE INDEX IF NOT EXISTS idx_cf_ops_timestamp ON cryptocrawler_capital_free_ops(timestamp);

-- ============================================
-- LEARNED PARAMETERS HISTORY
-- Tracks the evolution of learned parameters over time
-- Used for long-term optimization and hyperparameter tuning
-- ============================================
CREATE TABLE IF NOT EXISTS cryptocrawler_learned_params (
  id VARCHAR(255) PRIMARY KEY,
  test_run_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  performance_level VARCHAR(20) NOT NULL,
  optimal_success_rate REAL NOT NULL DEFAULT 0,
  optimal_profit_threshold REAL NOT NULL DEFAULT 0,
  optimal_slippage_tolerance REAL NOT NULL DEFAULT 0,
  optimal_gas_strategy VARCHAR(50),
  optimal_flash_loan_provider VARCHAR(100),
  optimal_p2p_partner_count INTEGER,
  optimal_barter_strategy VARCHAR(50),
  market_sensitivity JSONB DEFAULT '{}',
  competitor_adaptation JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_learned_params_test_run ON cryptocrawler_learned_params(test_run_id);
CREATE INDEX IF NOT EXISTS idx_learned_params_level ON cryptocrawler_learned_params(performance_level);
CREATE INDEX IF NOT EXISTS idx_learned_params_timestamp ON cryptocrawler_learned_params(timestamp);

-- ============================================
-- VIEWS FOR ANALYTICS
-- ============================================

-- View: Latest test results summary
CREATE OR REPLACE VIEW cryptocrawler_latest_results AS
SELECT 
  tr.test_run_id,
  tr.timestamp,
  tr.status,
  tr.duration,
  (tr.summary->>'avgWinRate')::REAL AS avg_win_rate,
  (tr.summary->>'avgSharpeRatio')::REAL AS avg_sharpe_ratio,
  (tr.summary->>'totalZeroCapitalProfit')::REAL AS zero_capital_profit,
  (tr.summary->>'capitalFreeOperationsSuccess')::REAL AS capital_free_success
FROM cryptocrawler_test_results tr
ORDER BY tr.timestamp DESC
LIMIT 100;

-- View: Evolution progress by level
CREATE OR REPLACE VIEW cryptocrawler_evolution_progress AS
SELECT 
  performance_level,
  COUNT(*) AS total_evolutions,
  AVG(fitness) AS avg_fitness,
  MAX(fitness) AS max_fitness,
  AVG(improvement_percent) AS avg_improvement
FROM cryptocrawler_evolutions
GROUP BY performance_level
ORDER BY avg_fitness DESC;

-- View: Capital-free operation success rates
CREATE OR REPLACE VIEW cryptocrawler_cf_success_rates AS
SELECT 
  operation_type,
  COUNT(*) AS total_ops,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful_ops,
  (SUM(CASE WHEN success THEN 1 ELSE 0 END)::REAL / COUNT(*)::REAL * 100) AS success_rate,
  AVG(profit_impact) AS avg_profit_impact
FROM cryptocrawler_capital_free_ops
GROUP BY operation_type
ORDER BY success_rate DESC;
