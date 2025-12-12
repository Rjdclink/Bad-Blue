-- Migration: Neural Spine - Binary Synapse Forge
-- Creates tables for the shared brainstem architecture
-- Supports Kriptera, Lexara, and 4Ji neural pathways

-- ============================================
-- NEURAL REGIONS TABLE
-- ============================================
-- Defines the three core neural regions:
-- - 4ji_core: Executive cortex
-- - kriptera: Sensorimotor / crypto / data hunting
-- - lexara: Speech + interface

CREATE TABLE IF NOT EXISTS neural_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default regions
INSERT INTO neural_regions (name, description) VALUES
  ('4ji_core', '4Ji Executive Cortex - Central orchestration and decision-making'),
  ('kriptera', 'Kriptera Sensorimotor Core - Crypto crawlers and data hunting'),
  ('lexara', 'Lexara Speech Interface - Two-way communications and voice')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- NEURAL SYNAPSES TABLE
-- ============================================
-- Binary synapses that connect concepts/patterns
-- "Nodes that fire together, wire together"

CREATE TABLE IF NOT EXISTS neural_synapses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Region connections (can be same region or cross-region)
  region_from UUID NOT NULL REFERENCES neural_regions(id) ON DELETE CASCADE,
  region_to UUID NOT NULL REFERENCES neural_regions(id) ON DELETE CASCADE,
  
  -- Binary nodes (fingerprinted concepts)
  from_node TEXT NOT NULL,  -- Hashed source concept
  to_node TEXT NOT NULL,    -- Hashed target concept
  
  -- Synapse strength
  weight FLOAT8 NOT NULL DEFAULT 0.5 CHECK (weight >= 0 AND weight <= 2),
  confidence FLOAT8 NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  
  -- Temporal tracking
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Attribution
  source_agent TEXT NOT NULL CHECK (source_agent IN ('4ji', 'kriptera', 'lexara')),
  context_hash TEXT NOT NULL,  -- Hash of the situation/request
  
  -- Categorization
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Decay configuration
  decay_rate FLOAT8 NOT NULL DEFAULT 0.01 CHECK (decay_rate >= 0 AND decay_rate <= 1)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_neural_synapses_regions 
  ON neural_synapses(region_from, region_to);
CREATE INDEX IF NOT EXISTS idx_neural_synapses_from_node 
  ON neural_synapses(from_node);
CREATE INDEX IF NOT EXISTS idx_neural_synapses_to_node 
  ON neural_synapses(to_node);
CREATE INDEX IF NOT EXISTS idx_neural_synapses_weight 
  ON neural_synapses(weight DESC);
CREATE INDEX IF NOT EXISTS idx_neural_synapses_confidence 
  ON neural_synapses(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_neural_synapses_tags 
  ON neural_synapses USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_neural_synapses_source_agent 
  ON neural_synapses(source_agent);
CREATE INDEX IF NOT EXISTS idx_neural_synapses_last_updated 
  ON neural_synapses(last_updated);

-- Unique constraint: one synapse per node pair per region pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_neural_synapses_unique_nodes 
  ON neural_synapses(region_from, region_to, from_node, to_node);

-- ============================================
-- NEURAL EVENTS TABLE
-- ============================================
-- Action potentials - records of neural firing

CREATE TABLE IF NOT EXISTS neural_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Region this event belongs to
  region_id UUID NOT NULL REFERENCES neural_regions(id) ON DELETE CASCADE,
  
  -- Agent that generated this event
  agent TEXT NOT NULL,
  
  -- Fingerprints
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  
  -- Outcome quality
  reward_score FLOAT8 NOT NULL CHECK (reward_score >= 0 AND reward_score <= 1),
  
  -- Additional context
  metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for neural events
CREATE INDEX IF NOT EXISTS idx_neural_events_region 
  ON neural_events(region_id);
CREATE INDEX IF NOT EXISTS idx_neural_events_agent 
  ON neural_events(agent);
CREATE INDEX IF NOT EXISTS idx_neural_events_input_fp 
  ON neural_events(input_fingerprint);
CREATE INDEX IF NOT EXISTS idx_neural_events_output_fp 
  ON neural_events(output_fingerprint);
CREATE INDEX IF NOT EXISTS idx_neural_events_reward 
  ON neural_events(reward_score DESC);
CREATE INDEX IF NOT EXISTS idx_neural_events_created 
  ON neural_events(created_at DESC);

-- ============================================
-- AI ROUTING POLICIES TABLE
-- ============================================
-- Defines how to route requests to AI models

CREATE TABLE IF NOT EXISTS ai_routing_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  primary_model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  fallback_model_ids UUID[] DEFAULT ARRAY[]::UUID[],
  strategy TEXT NOT NULL DEFAULT 'primary_first' 
    CHECK (strategy IN ('round_robin', 'weighted', 'latency_based', 'quality_based', 'primary_first')),
  weight_map JSONB DEFAULT '{}'::JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_routing_policies_name 
  ON ai_routing_policies(name);
CREATE INDEX IF NOT EXISTS idx_ai_routing_policies_enabled 
  ON ai_routing_policies(enabled);

-- ============================================
-- EVOLUTION LOCK TABLE
-- ============================================
-- Single-row table tracking 4Ji's evolution state

CREATE TABLE IF NOT EXISTS evolution_lock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure only one row exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_lock_singleton 
  ON evolution_lock ((TRUE));

-- Insert default unlocked state
INSERT INTO evolution_lock (locked, reason) 
VALUES (FALSE, 'Initial state - evolution enabled')
ON CONFLICT DO NOTHING;

-- ============================================
-- CREATOR WALLET DIRECTIVE TABLE
-- ============================================
-- Stores the creator's wallet address for financial enrichment
-- This is the top directive for 4Ji's Jewel of Financial Enrichment

CREATE TABLE IF NOT EXISTS creator_wallet_directive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_name TEXT NOT NULL DEFAULT 'Robert Joseph Dale Clinkenbeard',
  wallet_address TEXT,
  wallet_chain TEXT DEFAULT 'ethereum',
  priority_level INTEGER NOT NULL DEFAULT 1,  -- 1 = highest priority
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single row constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_wallet_singleton 
  ON creator_wallet_directive ((TRUE));

-- Insert default creator directive
INSERT INTO creator_wallet_directive (creator_name, priority_level, active)
VALUES ('Robert Joseph Dale Clinkenbeard', 1, TRUE)
ON CONFLICT DO NOTHING;

-- ============================================
-- CRYPTO PROFIT TRACKING TABLE
-- ============================================
-- Tracks all profits generated for the creator

CREATE TABLE IF NOT EXISTS crypto_profit_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent TEXT NOT NULL CHECK (source_agent IN ('4ji', 'kriptera', 'lexara')),
  operation_type TEXT NOT NULL,  -- 'arbitrage', 'trade', 'yield', 'airdrop', etc.
  chain TEXT NOT NULL,
  amount NUMERIC(30, 18) NOT NULL,
  token_symbol TEXT NOT NULL,
  token_address TEXT,
  transaction_hash TEXT,
  destination_wallet TEXT,  -- Should match creator's wallet
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'confirmed', 'failed', 'deposited')),
  profit_usd NUMERIC(20, 2),
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_profit_source 
  ON crypto_profit_tracking(source_agent);
CREATE INDEX IF NOT EXISTS idx_crypto_profit_status 
  ON crypto_profit_tracking(status);
CREATE INDEX IF NOT EXISTS idx_crypto_profit_created 
  ON crypto_profit_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_profit_destination 
  ON crypto_profit_tracking(destination_wallet);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get strongest synapses for a fingerprint
CREATE OR REPLACE FUNCTION get_strongest_synapses(
  p_fingerprint TEXT,
  p_region_name TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  synapse_id UUID,
  from_node TEXT,
  to_node TEXT,
  weight FLOAT8,
  confidence FLOAT8,
  strength FLOAT8,
  tags TEXT[],
  source_agent TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.from_node,
    s.to_node,
    s.weight,
    s.confidence,
    (s.weight * s.confidence) as strength,
    s.tags,
    s.source_agent
  FROM neural_synapses s
  LEFT JOIN neural_regions r_from ON s.region_from = r_from.id
  LEFT JOIN neural_regions r_to ON s.region_to = r_to.id
  WHERE 
    (s.from_node = p_fingerprint OR s.to_node = p_fingerprint)
    AND (p_region_name IS NULL OR r_from.name = p_region_name OR r_to.name = p_region_name)
  ORDER BY (s.weight * s.confidence) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to apply decay to old synapses
CREATE OR REPLACE FUNCTION apply_synapse_decay(
  p_max_age_hours INTEGER DEFAULT 24
)
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE neural_synapses
  SET 
    weight = weight * (1 - decay_rate),
    confidence = confidence * 0.999,
    last_updated = NOW()
  WHERE 
    last_updated < NOW() - (p_max_age_hours || ' hours')::INTERVAL
    AND weight > 0.01;
  
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get total profits for creator
CREATE OR REPLACE FUNCTION get_creator_total_profits()
RETURNS TABLE (
  total_usd NUMERIC,
  total_by_chain JSONB,
  total_by_operation JSONB,
  pending_count INTEGER,
  confirmed_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(profit_usd) FILTER (WHERE status = 'deposited'), 0) as total_usd,
    jsonb_object_agg(chain, chain_total) as total_by_chain,
    jsonb_object_agg(operation_type, op_total) as total_by_operation,
    COUNT(*) FILTER (WHERE status = 'pending')::INTEGER as pending_count,
    COUNT(*) FILTER (WHERE status IN ('confirmed', 'deposited'))::INTEGER as confirmed_count
  FROM (
    SELECT 
      chain,
      operation_type,
      status,
      profit_usd,
      SUM(profit_usd) OVER (PARTITION BY chain) as chain_total,
      SUM(profit_usd) OVER (PARTITION BY operation_type) as op_total
    FROM crypto_profit_tracking
  ) subq;
END;
$$ LANGUAGE plpgsql;
