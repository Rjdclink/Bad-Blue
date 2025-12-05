/**
 * PANTHEON Intelligence Core - Type Definitions
 * Phase 4A - Part 1: Core Types
 */

/**
 * Knowledge Graph Node
 * Represents entities in the knowledge graph
 */
export interface GraphNode {
  id: string;
  type: 'person' | 'organization' | 'location' | 'event' | 'document' | 'concept';
  properties: Record<string, any>;
  confidence: number;
  provenance: ProvenanceRecord[];
  createdAt: Date;
  updatedAt: Date;
  temporal?: TemporalData;
}

/**
 * Knowledge Graph Edge
 * Represents relationships between nodes
 */
export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  confidence: number;
  evidenceIds: string[];
  temporal?: TemporalData;
}

/**
 * Provenance Record
 * Tracks the source and verification status of data
 */
export interface ProvenanceRecord {
  sourceId: string;
  acquisitionMethod: string;
  timestamp: Date;
  verificationStatus: 'verified' | 'probable' | 'unverified';
}

/**
 * Temporal Data
 * Tracks time-based information for nodes and edges
 */
export interface TemporalData {
  startDate?: Date;
  endDate?: Date;
  timeline: Array<{ date: Date; event: string; source: string }>;
}

/**
 * Timeline
 * Aggregated timeline view for multiple nodes
 */
export interface Timeline {
  events: Array<{
    date: Date;
    event: string;
    nodeId: string;
    source: string;
  }>;
  startDate: Date;
  endDate: Date;
}

/**
 * Community
 * Result of community detection algorithm
 */
export interface Community {
  nodes: string[];
  strength: number;
  centralNodes?: string[];
}

/**
 * Raw Input for Preprocessing Engine
 */
export interface RawInput {
  data: any;
  sourceType: 'html' | 'json' | 'text' | 'image' | 'audio' | 'video' | 'pdf';
  sourceUrl?: string;
  metadata?: Record<string, any>;
}

/**
 * Normalized Data Output
 */
export interface NormalizedData {
  text?: string;
  entities: ExtractedEntity[];
  structured?: any;
  mediaAnalysis?: MediaAnalysis;
  confidence: number;
  provenance: string[];
}

/**
 * Extracted Entity
 */
export interface ExtractedEntity {
  type: 'person' | 'organization' | 'location' | 'date' | 'email' | 'phone' | 'url' | 'event';
  value: string;
  context: string;
  confidence: number;
  sourceReference: string;
  position?: { start: number; end: number };
}

/**
 * Media Analysis Result
 */
export interface MediaAnalysis {
  type: 'image' | 'video' | 'audio';
  ocrText?: string;
  transcript?: string;
  objects?: string[];
  geolocation?: { lat: number; lon: number };
  timestamp?: Date;
  metadata?: Record<string, any>;
}

/**
 * Entity Linking Result
 */
export interface EntityLink {
  entity1: ExtractedEntity;
  entity2: ExtractedEntity;
  relationship: string;
  confidence: number;
}

/**
 * Graph Query Filter
 */
export interface GraphNodeFilter {
  type?: GraphNode['type'];
  properties?: Record<string, any>;
  minConfidence?: number;
  createdAfter?: Date;
  createdBefore?: Date;
}
