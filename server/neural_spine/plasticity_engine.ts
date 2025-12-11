/**
 * Neural Spine - Plasticity Engine
 * 
 * Implements the "Binary Synapse Forge" - the core mechanism for creating
 * and strengthening neural synapses based on experiences.
 * 
 * "Nodes that fire together, wire together" - stored in Supabase, not model weights.
 */

import { EventEmitter } from 'events';
import {
  synapseStore,
  NeuralSynapse,
  NeuralEvent,
  CreateSynapseInput,
  NeuralRegionId,
  SourceAgent,
  DEFAULT_DECAY_RATE,
  INITIAL_CONFIDENCE,
  BASE_WEIGHT
} from './synapse_store';
import {
  makeInputFingerprint,
  makeOutputFingerprint,
  makeContextHash
} from './context_fingerprint';

// ============================================================================
// CONSTANTS
// ============================================================================

const LEARNING_RATE = 0.1;             // How much reward affects weight
const CONFIDENCE_INCREMENT = 0.05;     // Confidence boost per consistent positive
const MAX_WEIGHT = 2.0;                // Maximum synapse weight
const MAX_CONFIDENCE = 1.0;            // Maximum confidence
const MIN_WEIGHT = 0.01;               // Minimum synapse weight before pruning
const DECAY_INTERVAL_MS = 3600000;     // 1 hour between decay cycles

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ExperienceEvent {
  region: NeuralRegionId;
  agent: string;
  prompt: string;
  params?: Record<string, unknown>;
  result: unknown;
  rewardScore: number;  // 0-1 scale, how good/useful the outcome was
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface PlasticityMetrics {
  totalSynapsesCreated: number;
  totalSynapsesUpdated: number;
  totalEventsRecorded: number;
  averageWeight: number;
  averageConfidence: number;
  lastDecayAt: Date | null;
}

// ============================================================================
// PLASTICITY ENGINE CLASS
// ============================================================================

export const plasticityEvents = new EventEmitter();

class PlasticityEngine {
  private static instance: PlasticityEngine;
  private isInitialized: boolean = false;
  private metrics: PlasticityMetrics;
  private decayInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.metrics = {
      totalSynapsesCreated: 0,
      totalSynapsesUpdated: 0,
      totalEventsRecorded: 0,
      averageWeight: 0,
      averageConfidence: 0,
      lastDecayAt: null
    };
  }

  static getInstance(): PlasticityEngine {
    if (!PlasticityEngine.instance) {
      PlasticityEngine.instance = new PlasticityEngine();
    }
    return PlasticityEngine.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[PlasticityEngine] Initializing...');
    
    // Initialize synapse store
    await synapseStore.initialize();
    
    // Start decay timer
    this.startDecayTimer();
    
    this.isInitialized = true;
    console.log('[PlasticityEngine] Initialized');
  }

  /**
   * Update synapses based on a neural event
   * 
   * Core plasticity function:
   * 1. Derive input and output fingerprints
   * 2. Look up existing synapse between those nodes
   * 3. If none: create new synapse with base weight * reward
   * 4. If exists: update weight += learning_rate * reward
   */
  async updateSynapses(event: ExperienceEvent): Promise<void> {
    console.log(`[PlasticityEngine] Processing experience for ${event.region}:${event.agent}`);

    // 1. Derive fingerprints
    const inputFingerprint = makeInputFingerprint(
      event.prompt,
      event.region,
      event.agent,
      event.params
    );
    
    const outputFingerprint = makeOutputFingerprint(
      event.prompt,
      event.result,
      event.region,
      event.agent
    );
    
    const contextHash = makeContextHash(
      event.prompt,
      event.params || {},
      event.result,
      { domain: event.region, agent: event.agent, tags: event.tags }
    );

    // Get region IDs
    const regionId = synapseStore.getRegionId(event.region);
    if (!regionId) {
      console.warn(`[PlasticityEngine] Unknown region: ${event.region}`);
      return;
    }

    // 2. Look up existing synapse
    const existingSynapse = await synapseStore.getSynapse(
      regionId,
      regionId,
      inputFingerprint,
      outputFingerprint
    );

    if (!existingSynapse) {
      // 3. Create new synapse
      const initialWeight = BASE_WEIGHT * event.rewardScore;
      
      const newSynapse: CreateSynapseInput = {
        regionFromId: regionId,
        regionToId: regionId,
        fromNode: inputFingerprint,
        toNode: outputFingerprint,
        weight: Math.max(MIN_WEIGHT, initialWeight),
        confidence: INITIAL_CONFIDENCE,
        sourceAgent: this.mapAgentToSource(event.agent),
        contextHash,
        tags: event.tags || [],
        decayRate: DEFAULT_DECAY_RATE
      };

      const created = await synapseStore.createSynapse(newSynapse);
      
      if (created) {
        this.metrics.totalSynapsesCreated++;
        plasticityEvents.emit('synapse-created', {
          synapse: created,
          event
        });
        console.log(`[PlasticityEngine] Created new synapse: ${inputFingerprint.slice(0, 8)} -> ${outputFingerprint.slice(0, 8)}`);
      }
    } else {
      // 4. Update existing synapse
      const weightDelta = LEARNING_RATE * event.rewardScore;
      const newWeight = Math.min(MAX_WEIGHT, existingSynapse.weight + weightDelta);
      
      // Confidence increases with consistent positive rewards
      let newConfidence = existingSynapse.confidence;
      if (event.rewardScore > 0.5) {
        newConfidence = Math.min(MAX_CONFIDENCE, existingSynapse.confidence + CONFIDENCE_INCREMENT);
      } else if (event.rewardScore < 0.3) {
        // Slight confidence decrease for poor outcomes
        newConfidence = Math.max(0.1, existingSynapse.confidence - CONFIDENCE_INCREMENT * 0.5);
      }

      const updated = await synapseStore.updateSynapse(existingSynapse.id, {
        weight: newWeight,
        confidence: newConfidence
      });

      if (updated) {
        this.metrics.totalSynapsesUpdated++;
        plasticityEvents.emit('synapse-updated', {
          synapseId: existingSynapse.id,
          oldWeight: existingSynapse.weight,
          newWeight,
          oldConfidence: existingSynapse.confidence,
          newConfidence,
          event
        });
        console.log(`[PlasticityEngine] Updated synapse: weight ${existingSynapse.weight.toFixed(3)} -> ${newWeight.toFixed(3)}`);
      }
    }

    // Record the neural event
    await this.recordEvent({
      regionId,
      agent: event.agent,
      inputFingerprint,
      outputFingerprint,
      rewardScore: event.rewardScore,
      metadata: event.metadata
    });
  }

  /**
   * Record a neural event (action potential)
   */
  private async recordEvent(eventData: {
    regionId: string;
    agent: string;
    inputFingerprint: string;
    outputFingerprint: string;
    rewardScore: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const created = await synapseStore.createEvent({
      regionId: eventData.regionId,
      agent: eventData.agent,
      inputFingerprint: eventData.inputFingerprint,
      outputFingerprint: eventData.outputFingerprint,
      rewardScore: eventData.rewardScore,
      metadata: eventData.metadata || {}
    });

    if (created) {
      this.metrics.totalEventsRecorded++;
      plasticityEvents.emit('event-recorded', created);
    }
  }

  /**
   * Create cross-region synapse when agents collaborate
   */
  async createCrossRegionSynapse(
    fromRegion: NeuralRegionId,
    toRegion: NeuralRegionId,
    fromFingerprint: string,
    toFingerprint: string,
    rewardScore: number,
    sourceAgent: SourceAgent,
    contextHash: string,
    tags?: string[]
  ): Promise<NeuralSynapse | null> {
    const fromRegionId = synapseStore.getRegionId(fromRegion);
    const toRegionId = synapseStore.getRegionId(toRegion);

    if (!fromRegionId || !toRegionId) {
      console.warn(`[PlasticityEngine] Unknown regions: ${fromRegion} or ${toRegion}`);
      return null;
    }

    // Check for existing
    const existing = await synapseStore.getSynapse(
      fromRegionId,
      toRegionId,
      fromFingerprint,
      toFingerprint
    );

    if (existing) {
      // Update existing
      const newWeight = Math.min(MAX_WEIGHT, existing.weight + LEARNING_RATE * rewardScore);
      const newConfidence = Math.min(MAX_CONFIDENCE, existing.confidence + CONFIDENCE_INCREMENT);
      
      await synapseStore.updateSynapse(existing.id, {
        weight: newWeight,
        confidence: newConfidence
      });
      
      return { ...existing, weight: newWeight, confidence: newConfidence };
    }

    // Create new cross-region synapse
    const synapse = await synapseStore.createSynapse({
      regionFromId: fromRegionId,
      regionToId: toRegionId,
      fromNode: fromFingerprint,
      toNode: toFingerprint,
      weight: BASE_WEIGHT * rewardScore,
      confidence: INITIAL_CONFIDENCE,
      sourceAgent,
      contextHash,
      tags,
      decayRate: DEFAULT_DECAY_RATE
    });

    if (synapse) {
      this.metrics.totalSynapsesCreated++;
      plasticityEvents.emit('cross-region-synapse-created', {
        fromRegion,
        toRegion,
        synapse
      });
    }

    return synapse;
  }

  /**
   * Start periodic decay timer
   */
  private startDecayTimer(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
    }

    this.decayInterval = setInterval(async () => {
      await this.runDecayCycle();
    }, DECAY_INTERVAL_MS);
  }

  /**
   * Run decay cycle on old synapses
   */
  async runDecayCycle(): Promise<void> {
    console.log('[PlasticityEngine] Running decay cycle...');
    
    const decayed = await synapseStore.applyDecay();
    this.metrics.lastDecayAt = new Date();
    
    console.log(`[PlasticityEngine] Decayed ${decayed} synapses`);
    
    plasticityEvents.emit('decay-cycle-complete', {
      decayedCount: decayed,
      timestamp: this.metrics.lastDecayAt
    });
  }

  /**
   * Map agent name to SourceAgent enum
   */
  private mapAgentToSource(agent: string): SourceAgent {
    const agentLower = agent.toLowerCase();
    if (agentLower.includes('kriptera') || agentLower.includes('crypto')) {
      return 'kriptera';
    }
    if (agentLower.includes('lexara') || agentLower.includes('voice')) {
      return 'lexara';
    }
    return '4ji';
  }

  /**
   * Get plasticity metrics
   */
  getMetrics(): PlasticityMetrics {
    return { ...this.metrics };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[PlasticityEngine] Shutting down...');
    
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
    
    this.isInitialized = false;
    console.log('[PlasticityEngine] Shutdown complete');
  }
}

// Export singleton
export const plasticityEngine = PlasticityEngine.getInstance();

export async function initializePlasticityEngine(): Promise<void> {
  await plasticityEngine.initialize();
}

export async function updateSynapses(event: ExperienceEvent): Promise<void> {
  await plasticityEngine.updateSynapses(event);
}

export function getPlasticityMetrics(): PlasticityMetrics {
  return plasticityEngine.getMetrics();
}

export async function shutdownPlasticityEngine(): Promise<void> {
  await plasticityEngine.shutdown();
}

export default plasticityEngine;
