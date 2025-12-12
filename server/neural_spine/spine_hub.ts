/**
 * Neural Spine - Spine Hub Module
 * 
 * The Brainstem Router - the central hub that all agents plug into.
 * Provides:
 * - recordExperience(): Store experiences and update synapses
 * - querySynapses(): Find relevant patterns from past experiences
 * 
 * This makes the brainstem reusable by all agents:
 * - Kriptera (crypto/crawlers)
 * - Lexara (voice/comms)
 * - 4Ji (executive cortex)
 */

import { EventEmitter } from 'events';
import {
  plasticityEngine,
  plasticityEvents,
  initializePlasticityEngine,
  ExperienceEvent,
  PlasticityMetrics
} from './plasticity_engine';
import {
  synapseStore,
  initializeSynapseStore,
  NeuralSynapse,
  NeuralRegionId,
  SynapseQuery
} from './synapse_store';

// Re-export NeuralSynapse for adapters
export { NeuralSynapse };
import {
  makeInputFingerprint,
  makeFingerprint
} from './context_fingerprint';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RecordExperienceInput {
  region: NeuralRegionId;
  agent: string;
  prompt: string;
  params?: Record<string, unknown>;
  result: unknown;
  rewardScore: number;  // 0-1 scale
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface QuerySynapsesInput {
  region?: NeuralRegionId;
  fingerprint: string;
  maxResults?: number;
  minWeight?: number;
  minConfidence?: number;
  tags?: string[];
}

export interface SpineHubStatus {
  initialized: boolean;
  plasticityMetrics: PlasticityMetrics;
  regionIds: Map<string, string>;
}

// ============================================================================
// SPINE HUB CLASS
// ============================================================================

export const spineHubEvents = new EventEmitter();

class SpineHub {
  private static instance: SpineHub;
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): SpineHub {
    if (!SpineHub.instance) {
      SpineHub.instance = new SpineHub();
    }
    return SpineHub.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[SpineHub] Initializing Neural Spine Brainstem...');
    
    // Initialize synapse store first
    await initializeSynapseStore();
    
    // Initialize plasticity engine
    await initializePlasticityEngine();
    
    // Forward plasticity events
    plasticityEvents.on('synapse-created', (data) => {
      spineHubEvents.emit('synapse-created', data);
    });
    
    plasticityEvents.on('synapse-updated', (data) => {
      spineHubEvents.emit('synapse-updated', data);
    });
    
    plasticityEvents.on('event-recorded', (data) => {
      spineHubEvents.emit('event-recorded', data);
    });
    
    plasticityEvents.on('cross-region-synapse-created', (data) => {
      spineHubEvents.emit('cross-region-synapse-created', data);
    });

    this.isInitialized = true;
    console.log('[SpineHub] Neural Spine Brainstem initialized');
    spineHubEvents.emit('initialized');
  }

  /**
   * Record an experience and update synapses
   * 
   * This is the main entry point for agents to record their experiences.
   * It:
   * 1. Builds a NeuralEvent
   * 2. Saves it to neural_events
   * 3. Calls updateSynapses() to forge/strengthen connections
   */
  async recordExperience(input: RecordExperienceInput): Promise<void> {
    if (!this.isInitialized) {
      console.warn('[SpineHub] Not initialized, initializing now...');
      await this.initialize();
    }

    console.log(`[SpineHub] Recording experience: ${input.region}:${input.agent}`);

    const event: ExperienceEvent = {
      region: input.region,
      agent: input.agent,
      prompt: input.prompt,
      params: input.params,
      result: input.result,
      rewardScore: Math.max(0, Math.min(1, input.rewardScore)), // Clamp to 0-1
      tags: input.tags,
      metadata: {
        ...input.metadata,
        recordedAt: new Date().toISOString()
      }
    };

    await plasticityEngine.updateSynapses(event);

    spineHubEvents.emit('experience-recorded', {
      region: input.region,
      agent: input.agent,
      rewardScore: input.rewardScore
    });
  }

  /**
   * Query synapses to find relevant patterns from past experiences
   * 
   * This is how agents recall learned patterns:
   * - Generate fingerprint of current context
   * - Find synapses where from_node or to_node matches
   * - Return top N by weight * confidence
   */
  async querySynapses(input: QuerySynapsesInput): Promise<NeuralSynapse[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    console.log(`[SpineHub] Querying synapses: fingerprint=${input.fingerprint.slice(0, 12)}...`);

    const query: SynapseQuery = {
      fingerprint: input.fingerprint,
      maxResults: input.maxResults || 10,
      minWeight: input.minWeight,
      minConfidence: input.minConfidence,
      tags: input.tags
    };

    if (input.region) {
      query.region = input.region;
    }

    const synapses = await synapseStore.querySynapses(query);

    console.log(`[SpineHub] Found ${synapses.length} relevant synapses`);
    
    return synapses;
  }

  /**
   * Get synapses for a given context (convenience method)
   */
  async getSynapsesForContext(
    prompt: string,
    region?: NeuralRegionId,
    params?: Record<string, unknown>,
    maxResults: number = 10
  ): Promise<NeuralSynapse[]> {
    const fingerprint = makeInputFingerprint(prompt, region, undefined, params);
    
    return this.querySynapses({
      region,
      fingerprint,
      maxResults
    });
  }

  /**
   * Record cross-region collaboration
   * 
   * When one agent calls another and gets a good result,
   * this creates a synapse linking their fingerprints.
   */
  async recordCrossRegionExperience(
    fromRegion: NeuralRegionId,
    toRegion: NeuralRegionId,
    fromPrompt: string,
    toResult: unknown,
    rewardScore: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    console.log(`[SpineHub] Recording cross-region experience: ${fromRegion} -> ${toRegion}`);

    const fromFingerprint = makeInputFingerprint(fromPrompt, fromRegion);
    const toFingerprint = makeFingerprint({
      prompt: fromPrompt,
      result: toResult,
      domain: toRegion
    });
    
    const contextHash = makeFingerprint({
      prompt: fromPrompt,
      result: toResult,
      domain: `${fromRegion}->${toRegion}`
    });

    await plasticityEngine.createCrossRegionSynapse(
      fromRegion,
      toRegion,
      fromFingerprint,
      toFingerprint,
      rewardScore,
      '4ji',  // Cross-region always attributed to 4Ji as orchestrator
      contextHash,
      ['cross-region', fromRegion, toRegion]
    );
  }

  /**
   * Get strongest patterns for an agent
   */
  async getStrongestPatterns(
    region: NeuralRegionId,
    maxResults: number = 20
  ): Promise<NeuralSynapse[]> {
    return synapseStore.querySynapses({
      region,
      maxResults,
      minWeight: 0.5,
      minConfidence: 0.5
    });
  }

  /**
   * Get status of the spine hub
   */
  getStatus(): SpineHubStatus {
    return {
      initialized: this.isInitialized,
      plasticityMetrics: plasticityEngine.getMetrics(),
      regionIds: new Map([
        ['4ji_core', synapseStore.getRegionId('4ji_core') || ''],
        ['kriptera', synapseStore.getRegionId('kriptera') || ''],
        ['lexara', synapseStore.getRegionId('lexara') || '']
      ])
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[SpineHub] Shutting down...');
    
    await plasticityEngine.shutdown();
    
    this.isInitialized = false;
    console.log('[SpineHub] Shutdown complete');
    spineHubEvents.emit('shutdown');
  }
}

// Export singleton
export const spineHub = SpineHub.getInstance();

// Export convenience functions
export async function initializeSpineHub(): Promise<void> {
  await spineHub.initialize();
}

export async function recordExperience(input: RecordExperienceInput): Promise<void> {
  await spineHub.recordExperience(input);
}

export async function querySynapses(input: QuerySynapsesInput): Promise<NeuralSynapse[]> {
  return spineHub.querySynapses(input);
}

export async function getSynapsesForContext(
  prompt: string,
  region?: NeuralRegionId,
  params?: Record<string, unknown>,
  maxResults?: number
): Promise<NeuralSynapse[]> {
  return spineHub.getSynapsesForContext(prompt, region, params, maxResults);
}

export async function recordCrossRegionExperience(
  fromRegion: NeuralRegionId,
  toRegion: NeuralRegionId,
  fromPrompt: string,
  toResult: unknown,
  rewardScore: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  await spineHub.recordCrossRegionExperience(
    fromRegion, toRegion, fromPrompt, toResult, rewardScore, metadata
  );
}

export function getSpineHubStatus(): SpineHubStatus {
  return spineHub.getStatus();
}

export async function shutdownSpineHub(): Promise<void> {
  await spineHub.shutdown();
}

export default spineHub;
