/**
 * Neural Spine - Synapse Store Module
 * 
 * Handles persistence of neural synapses to Supabase.
 * Provides CRUD operations for neural_regions, neural_synapses, and neural_events tables.
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type NeuralRegionId = '4ji_core' | 'kriptera' | 'lexara';
export type SourceAgent = '4ji' | 'kriptera' | 'lexara';

export interface NeuralRegion {
  id: string;
  name: NeuralRegionId;
  description: string;
  createdAt: Date;
}

export interface NeuralSynapse {
  id: string;
  regionFrom: string;
  regionTo: string;
  fromNode: string;      // Fingerprinted source concept
  toNode: string;        // Fingerprinted target concept
  weight: number;
  confidence: number;
  lastUpdated: Date;
  createdAt: Date;
  sourceAgent: SourceAgent;
  contextHash: string;
  tags: string[];
  decayRate: number;
}

export interface NeuralEvent {
  id: string;
  regionId: string;
  agent: string;
  inputFingerprint: string;
  outputFingerprint: string;
  rewardScore: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateSynapseInput {
  regionFromId: string;
  regionToId: string;
  fromNode: string;
  toNode: string;
  weight: number;
  confidence: number;
  sourceAgent: SourceAgent;
  contextHash: string;
  tags?: string[];
  decayRate?: number;
}

export interface CreateEventInput {
  regionId: string;
  agent: string;
  inputFingerprint: string;
  outputFingerprint: string;
  rewardScore: number;
  metadata?: Record<string, unknown>;
}

export interface SynapseQuery {
  region?: string;
  fromNode?: string;
  toNode?: string;
  fingerprint?: string;  // Searches both from_node and to_node
  minWeight?: number;
  minConfidence?: number;
  maxResults?: number;
  tags?: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_DECAY_RATE = 0.01;  // 1% decay per cycle
const INITIAL_CONFIDENCE = 0.5;
const BASE_WEIGHT = 0.5;

// ============================================================================
// SYNAPSE STORE CLASS
// ============================================================================

class SynapseStore {
  private static instance: SynapseStore;
  private isInitialized: boolean = false;
  private regionCache: Map<NeuralRegionId, string> = new Map();

  private constructor() {}

  static getInstance(): SynapseStore {
    if (!SynapseStore.instance) {
      SynapseStore.instance = new SynapseStore();
    }
    return SynapseStore.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[SynapseStore] Initializing...');
    
    // Ensure regions exist and cache their IDs
    await this.ensureRegions();
    
    this.isInitialized = true;
    console.log('[SynapseStore] Initialized');
  }

  /**
   * Ensure neural regions exist in database
   */
  private async ensureRegions(): Promise<void> {
    const regions: { name: NeuralRegionId; description: string }[] = [
      { name: '4ji_core', description: '4Ji Executive Cortex - Central orchestration and decision-making' },
      { name: 'kriptera', description: 'Kriptera Sensorimotor Core - Crypto crawlers and data hunting' },
      { name: 'lexara', description: 'Lexara Speech Interface - Two-way communications and voice' }
    ];

    for (const region of regions) {
      try {
        // Check if region exists
        const existing = await db.execute(sql`
          SELECT id FROM neural_regions WHERE name = ${region.name}
        `);

        if (existing.rows && existing.rows.length > 0) {
          this.regionCache.set(region.name, existing.rows[0].id as string);
        } else {
          // Create region
          const result = await db.execute(sql`
            INSERT INTO neural_regions (name, description)
            VALUES (${region.name}, ${region.description})
            RETURNING id
          `);
          
          if (result.rows && result.rows.length > 0) {
            this.regionCache.set(region.name, result.rows[0].id as string);
          }
        }
      } catch (error: any) {
        // Table might not exist yet - that's OK, migration will create it
        console.warn(`[SynapseStore] Could not ensure region ${region.name}:`, error.message);
      }
    }
  }

  /**
   * Get region ID by name
   */
  getRegionId(name: NeuralRegionId): string | undefined {
    return this.regionCache.get(name);
  }

  /**
   * Create a new synapse
   */
  async createSynapse(input: CreateSynapseInput): Promise<NeuralSynapse | null> {
    try {
      const result = await db.execute(sql`
        INSERT INTO neural_synapses (
          region_from, region_to, from_node, to_node,
          weight, confidence, source_agent, context_hash,
          tags, decay_rate
        ) VALUES (
          ${input.regionFromId}, ${input.regionToId},
          ${input.fromNode}, ${input.toNode},
          ${input.weight}, ${input.confidence},
          ${input.sourceAgent}, ${input.contextHash},
          ${input.tags || []}, ${input.decayRate || DEFAULT_DECAY_RATE}
        )
        RETURNING *
      `);

      if (result.rows && result.rows.length > 0) {
        return this.mapSynapseRow(result.rows[0]);
      }
      return null;
    } catch (error: any) {
      console.error('[SynapseStore] Failed to create synapse:', error.message);
      return null;
    }
  }

  /**
   * Get synapse by from_node and to_node
   */
  async getSynapse(
    regionFromId: string,
    regionToId: string,
    fromNode: string,
    toNode: string
  ): Promise<NeuralSynapse | null> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM neural_synapses
        WHERE region_from = ${regionFromId}
          AND region_to = ${regionToId}
          AND from_node = ${fromNode}
          AND to_node = ${toNode}
        LIMIT 1
      `);

      if (result.rows && result.rows.length > 0) {
        return this.mapSynapseRow(result.rows[0]);
      }
      return null;
    } catch (error: any) {
      console.error('[SynapseStore] Failed to get synapse:', error.message);
      return null;
    }
  }

  /**
   * Update synapse weight and confidence
   */
  async updateSynapse(
    synapseId: string,
    updates: { weight?: number; confidence?: number }
  ): Promise<boolean> {
    try {
      const setClauses: string[] = ['last_updated = NOW()'];
      
      if (updates.weight !== undefined) {
        setClauses.push(`weight = ${updates.weight}`);
      }
      if (updates.confidence !== undefined) {
        setClauses.push(`confidence = ${updates.confidence}`);
      }

      await db.execute(sql.raw(`
        UPDATE neural_synapses
        SET ${setClauses.join(', ')}
        WHERE id = '${synapseId}'
      `));

      return true;
    } catch (error: any) {
      console.error('[SynapseStore] Failed to update synapse:', error.message);
      return false;
    }
  }

  /**
   * Query synapses by criteria
   */
  async querySynapses(query: SynapseQuery): Promise<NeuralSynapse[]> {
    try {
      const conditions: string[] = [];
      
      if (query.region) {
        const regionId = this.regionCache.get(query.region as NeuralRegionId);
        if (regionId) {
          conditions.push(`(region_from = '${regionId}' OR region_to = '${regionId}')`);
        }
      }
      
      if (query.fromNode) {
        conditions.push(`from_node = '${query.fromNode}'`);
      }
      
      if (query.toNode) {
        conditions.push(`to_node = '${query.toNode}'`);
      }
      
      if (query.fingerprint) {
        conditions.push(`(from_node = '${query.fingerprint}' OR to_node = '${query.fingerprint}')`);
      }
      
      if (query.minWeight !== undefined) {
        conditions.push(`weight >= ${query.minWeight}`);
      }
      
      if (query.minConfidence !== undefined) {
        conditions.push(`confidence >= ${query.minConfidence}`);
      }
      
      if (query.tags && query.tags.length > 0) {
        conditions.push(`tags && ARRAY[${query.tags.map(t => `'${t}'`).join(',')}]`);
      }

      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';
      
      const limit = query.maxResults || 100;

      const result = await db.execute(sql.raw(`
        SELECT * FROM neural_synapses
        ${whereClause}
        ORDER BY (weight * confidence) DESC
        LIMIT ${limit}
      `));

      if (result.rows) {
        return result.rows.map(row => this.mapSynapseRow(row));
      }
      return [];
    } catch (error: any) {
      console.error('[SynapseStore] Failed to query synapses:', error.message);
      return [];
    }
  }

  /**
   * Create a neural event
   */
  async createEvent(input: CreateEventInput): Promise<NeuralEvent | null> {
    try {
      const result = await db.execute(sql`
        INSERT INTO neural_events (
          region_id, agent, input_fingerprint, output_fingerprint,
          reward_score, metadata
        ) VALUES (
          ${input.regionId}, ${input.agent},
          ${input.inputFingerprint}, ${input.outputFingerprint},
          ${input.rewardScore}, ${JSON.stringify(input.metadata || {})}
        )
        RETURNING *
      `);

      if (result.rows && result.rows.length > 0) {
        return this.mapEventRow(result.rows[0]);
      }
      return null;
    } catch (error: any) {
      console.error('[SynapseStore] Failed to create event:', error.message);
      return null;
    }
  }

  /**
   * Apply decay to old synapses
   */
  async applyDecay(maxAge: number = 86400000): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - maxAge);
      
      const result = await db.execute(sql`
        UPDATE neural_synapses
        SET weight = weight * (1 - decay_rate),
            confidence = confidence * 0.999
        WHERE last_updated < ${cutoffDate.toISOString()}
          AND weight > 0.01
        RETURNING id
      `);

      return result.rows?.length || 0;
    } catch (error: any) {
      console.error('[SynapseStore] Failed to apply decay:', error.message);
      return 0;
    }
  }

  /**
   * Get strongest synapses for a fingerprint
   */
  async getStrongestSynapses(
    fingerprint: string,
    region?: string,
    maxResults: number = 10
  ): Promise<NeuralSynapse[]> {
    return this.querySynapses({
      fingerprint,
      region,
      maxResults,
      minWeight: 0.1,
      minConfidence: 0.3
    });
  }

  /**
   * Map database row to NeuralSynapse
   */
  private mapSynapseRow(row: Record<string, unknown>): NeuralSynapse {
    return {
      id: row.id as string,
      regionFrom: row.region_from as string,
      regionTo: row.region_to as string,
      fromNode: row.from_node as string,
      toNode: row.to_node as string,
      weight: row.weight as number,
      confidence: row.confidence as number,
      lastUpdated: new Date(row.last_updated as string),
      createdAt: new Date(row.created_at as string),
      sourceAgent: row.source_agent as SourceAgent,
      contextHash: row.context_hash as string,
      tags: row.tags as string[],
      decayRate: row.decay_rate as number
    };
  }

  /**
   * Map database row to NeuralEvent
   */
  private mapEventRow(row: Record<string, unknown>): NeuralEvent {
    return {
      id: row.id as string,
      regionId: row.region_id as string,
      agent: row.agent as string,
      inputFingerprint: row.input_fingerprint as string,
      outputFingerprint: row.output_fingerprint as string,
      rewardScore: row.reward_score as number,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: new Date(row.created_at as string)
    };
  }
}

// Export singleton
export const synapseStore = SynapseStore.getInstance();

export async function initializeSynapseStore(): Promise<void> {
  await synapseStore.initialize();
}

export default synapseStore;

// Export constants
export { DEFAULT_DECAY_RATE, INITIAL_CONFIDENCE, BASE_WEIGHT };
