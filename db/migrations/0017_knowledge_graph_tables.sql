-- Migration: Knowledge Graph Tables for PANTHEON Intelligence Core
-- Phase 4A - Part 1: Database Schema
-- Foundation Layer for autonomous intelligence

-- Knowledge Graph Nodes
CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR NOT NULL CHECK (type IN ('person', 'organization', 'location', 'event', 'document', 'concept')),
  properties JSONB NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  provenance JSONB NOT NULL DEFAULT '[]',
  temporal JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_kg_nodes_type ON knowledge_graph_nodes(type);
CREATE INDEX idx_kg_nodes_properties ON knowledge_graph_nodes USING gin(properties);
CREATE INDEX idx_kg_nodes_confidence ON knowledge_graph_nodes(confidence DESC);
CREATE INDEX idx_kg_nodes_created ON knowledge_graph_nodes(created_at DESC);

-- Knowledge Graph Edges
CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR NOT NULL,
  target_id VARCHAR NOT NULL,
  relationship VARCHAR NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0 AND weight <= 1),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  temporal JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Foreign keys with CASCADE delete
  CONSTRAINT fk_source FOREIGN KEY (source_id) 
    REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
  CONSTRAINT fk_target FOREIGN KEY (target_id) 
    REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE
);

-- Indexes for graph traversal
CREATE INDEX idx_kg_edges_source ON knowledge_graph_edges(source_id);
CREATE INDEX idx_kg_edges_target ON knowledge_graph_edges(target_id);
CREATE INDEX idx_kg_edges_relationship ON knowledge_graph_edges(relationship);
CREATE INDEX idx_kg_edges_weight ON knowledge_graph_edges(weight DESC);
CREATE INDEX idx_kg_edges_source_target ON knowledge_graph_edges(source_id, target_id);

-- Knowledge Graph Queries (cached query results)
CREATE TABLE IF NOT EXISTS knowledge_graph_queries (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash VARCHAR NOT NULL UNIQUE,
  query_params JSONB NOT NULL,
  result_node_ids TEXT[],
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_kg_queries_hash ON knowledge_graph_queries(query_hash);
CREATE INDEX idx_kg_queries_expires ON knowledge_graph_queries(expires_at);
