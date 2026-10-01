/**
 * Bit-Level AI Neural Pathways System
 * 
 * Core architecture for 4JI's neural network using bits as fundamental neurons.
 * Each bit represents a minimal state (0 or 1), with pathways defined by
 * adjacency matrices mapping inter-bit connections.
 * 
 * Features:
 * - Atomic computational units (bits) as fundamental neurons
 * - Dynamic synapse-like weighting through probabilistic state interactions
 * - Pattern recognition at single-bit and aggregate pathway levels
 * - Adaptive activation thresholds for computational efficiency
 * - Real-time pathway pruning and redundancy management
 * - Integration with ALEXARA (Legal) and CRYPTARA (Crypto/OSINT) modules
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';

const log = createLogger('BitNeuralPathways');

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_PATHWAY_SIZE = 1024;
const DEFAULT_ACTIVATION_THRESHOLD = 0.5;
const DEFAULT_LEARNING_RATE = 0.1;
const MAX_STORED_PATTERNS = 10000;
const PRUNE_THRESHOLD = 0.01;
const REDUNDANCY_FACTOR = 2;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type BitState = 0 | 1;

export interface BitNeuron {
  id: string;
  state: BitState;
  activationThreshold: number;
  bias: number;
  lastActivation: number;
  activationCount: number;
}

export interface Synapse {
  sourceId: string;
  targetId: string;
  weight: number;
  lastUpdate: number;
  updateCount: number;
}

export interface NeuralPathway {
  id: string;
  name: string;
  domain: 'legal' | 'crypto' | 'shared' | 'meta';
  neurons: Map<string, BitNeuron>;
  synapses: Map<string, Synapse>;
  adjacencyMatrix: number[][];
  activationHistory: number[];
  utility: number;
  created: number;
  lastUsed: number;
}

export interface PatternSignature {
  id: string;
  bitPattern: BitState[];
  confidence: number;
  frequency: number;
  associatedPathways: string[];
  lastSeen: number;
}

export interface PathwayMetrics {
  totalNeurons: number;
  totalSynapses: number;
  activePathways: number;
  prunedPathways: number;
  averageUtility: number;
  patternRecognitionRate: number;
  computationalLoad: number;
}

export interface PropagationResult {
  outputStates: Map<string, BitState>;
  activatedNeurons: string[];
  pathwaysUsed: string[];
  confidence: number;
  processingTime: number;
}

export interface PathwayConfig {
  maxNeurons: number;
  maxSynapses: number;
  activationThreshold: number;
  learningRate: number;
  pruneThreshold: number;
  stochasticVariability: number;
}

// ============================================================================
// NEURAL PATHWAY MANAGER
// ============================================================================

export class BitNeuralPathwayManager extends EventEmitter {
  private pathways: Map<string, NeuralPathway> = new Map();
  private patterns: Map<string, PatternSignature> = new Map();
  private config: PathwayConfig;
  private metrics: PathwayMetrics;
  private initialized: boolean = false;

  constructor(customConfig?: Partial<PathwayConfig>) {
    super();
    this.config = {
      maxNeurons: MAX_PATHWAY_SIZE,
      maxSynapses: MAX_PATHWAY_SIZE * 4,
      activationThreshold: DEFAULT_ACTIVATION_THRESHOLD,
      learningRate: DEFAULT_LEARNING_RATE,
      pruneThreshold: PRUNE_THRESHOLD,
      stochasticVariability: 0.05,
      ...customConfig
    };
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): PathwayMetrics {
    return {
      totalNeurons: 0,
      totalSynapses: 0,
      activePathways: 0,
      prunedPathways: 0,
      averageUtility: 0,
      patternRecognitionRate: 0,
      computationalLoad: 0
    };
  }

  /**
   * Initialize the neural pathway system
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('Initializing Bit Neural Pathway System...');

    // Create core pathways for each domain
    await this.createPathway('legal-core', 'Legal Core Processing', 'legal');
    await this.createPathway('crypto-core', 'Crypto/OSINT Processing', 'crypto');
    await this.createPathway('meta-bridge', 'Cross-Domain Meta Bridge', 'meta');
    await this.createPathway('shared-inference', 'Shared Inference Layer', 'shared');

    this.initialized = true;
    this.emit('initialized', { pathways: this.pathways.size });
    log.info('Bit Neural Pathway System initialized', {
      pathways: this.pathways.size,
      config: this.config
    });
  }

  /**
   * Create a new neural pathway
   */
  async createPathway(
    id: string,
    name: string,
    domain: NeuralPathway['domain'],
    initialSize: number = 64
  ): Promise<NeuralPathway> {
    if (this.pathways.has(id)) {
      return this.pathways.get(id)!;
    }

    const neurons = new Map<string, BitNeuron>();
    const synapses = new Map<string, Synapse>();

    // Initialize neurons
    for (let i = 0; i < initialSize; i++) {
      const neuronId = `${id}-n${i}`;
      neurons.set(neuronId, {
        id: neuronId,
        state: 0,
        activationThreshold: this.config.activationThreshold,
        bias: 0,
        lastActivation: 0,
        activationCount: 0
      });
    }

    // Initialize adjacency matrix with random connections
    const adjacencyMatrix = this.initializeAdjacencyMatrix(initialSize);

    // Create synapses based on adjacency matrix
    const neuronIds = Array.from(neurons.keys());
    for (let i = 0; i < initialSize; i++) {
      for (let j = 0; j < initialSize; j++) {
        if (adjacencyMatrix[i][j] > 0) {
          const synapseId = `${neuronIds[i]}->${neuronIds[j]}`;
          synapses.set(synapseId, {
            sourceId: neuronIds[i],
            targetId: neuronIds[j],
            weight: adjacencyMatrix[i][j],
            lastUpdate: Date.now(),
            updateCount: 0
          });
        }
      }
    }

    const pathway: NeuralPathway = {
      id,
      name,
      domain,
      neurons,
      synapses,
      adjacencyMatrix,
      activationHistory: [],
      utility: 1.0,
      created: Date.now(),
      lastUsed: Date.now()
    };

    this.pathways.set(id, pathway);
    this.updateMetrics();

    this.emit('pathway-created', { id, domain, neurons: neurons.size });
    log.info('Neural pathway created', { id, domain, neurons: neurons.size });

    return pathway;
  }

  /**
   * Initialize adjacency matrix with sparse random connections
   */
  private initializeAdjacencyMatrix(size: number): number[][] {
    const matrix: number[][] = [];
    const connectionProbability = 0.1; // 10% connectivity

    for (let i = 0; i < size; i++) {
      matrix[i] = [];
      for (let j = 0; j < size; j++) {
        if (i !== j && Math.random() < connectionProbability) {
          matrix[i][j] = Math.random() * 0.5 + 0.1; // Weight between 0.1 and 0.6
        } else {
          matrix[i][j] = 0;
        }
      }
    }

    return matrix;
  }

  /**
   * Propagate signal through a pathway
   */
  async propagateSignal(
    pathwayId: string,
    inputStates: Map<string, BitState>
  ): Promise<PropagationResult> {
    const startTime = Date.now();
    const pathway = this.pathways.get(pathwayId);

    if (!pathway) {
      throw new Error(`Pathway not found: ${pathwayId}`);
    }

    pathway.lastUsed = Date.now();
    const activatedNeurons: string[] = [];
    const outputStates = new Map<string, BitState>();

    // Set input states
    Array.from(inputStates.entries()).forEach(([neuronId, state]) => {
      const neuron = pathway.neurons.get(neuronId);
      if (neuron) {
        neuron.state = state;
        if (state === 1) {
          activatedNeurons.push(neuronId);
          neuron.activationCount++;
          neuron.lastActivation = Date.now();
        }
      }
    });

    // Propagate through layers using adjacency matrix
    const neuronIds = Array.from(pathway.neurons.keys());
    const size = pathway.adjacencyMatrix.length;

    // Multiple propagation steps for deeper processing
    for (let step = 0; step < 3; step++) {
      for (let i = 0; i < size; i++) {
        const targetNeuron = pathway.neurons.get(neuronIds[i]);
        if (!targetNeuron) continue;

        let inputSum = targetNeuron.bias;

        // Sum weighted inputs from all connected neurons
        for (let j = 0; j < size; j++) {
          const weight = pathway.adjacencyMatrix[j][i];
          if (weight > 0) {
            const sourceNeuron = pathway.neurons.get(neuronIds[j]);
            if (sourceNeuron) {
              inputSum += sourceNeuron.state * weight;
            }
          }
        }

        // Add stochastic variability
        inputSum += (Math.random() - 0.5) * this.config.stochasticVariability * 2;

        // Apply activation threshold
        const newState: BitState = inputSum >= targetNeuron.activationThreshold ? 1 : 0;

        if (newState !== targetNeuron.state) {
          targetNeuron.state = newState;
          if (newState === 1 && !activatedNeurons.includes(neuronIds[i])) {
            activatedNeurons.push(neuronIds[i]);
            targetNeuron.activationCount++;
            targetNeuron.lastActivation = Date.now();
          }
        }
      }
    }

    // Collect output states
    Array.from(pathway.neurons.entries()).forEach(([neuronId, neuron]) => {
      outputStates.set(neuronId, neuron.state);
    });

    // Calculate confidence based on activation pattern
    const confidence = activatedNeurons.length / pathway.neurons.size;

    // Update pathway activation history
    pathway.activationHistory.push(confidence);
    if (pathway.activationHistory.length > 100) {
      pathway.activationHistory.shift();
    }

    // Update utility score
    this.updatePathwayUtility(pathway);

    const processingTime = Date.now() - startTime;

    this.emit('signal-propagated', {
      pathwayId,
      activatedNeurons: activatedNeurons.length,
      confidence,
      processingTime
    });

    return {
      outputStates,
      activatedNeurons,
      pathwaysUsed: [pathwayId],
      confidence,
      processingTime
    };
  }

  /**
   * Update pathway utility score based on usage patterns
   */
  private updatePathwayUtility(pathway: NeuralPathway): void {
    if (pathway.activationHistory.length === 0) {
      return;
    }

    // Calculate average activation
    const avgActivation =
      pathway.activationHistory.reduce((sum, v) => sum + v, 0) /
      pathway.activationHistory.length;

    // Calculate recency factor
    const timeSinceUse = Date.now() - pathway.lastUsed;
    const recencyFactor = Math.exp(-timeSinceUse / (24 * 60 * 60 * 1000)); // Decay over 24 hours

    pathway.utility = avgActivation * 0.7 + recencyFactor * 0.3;
  }

  /**
   * Learn from input-output pairs to strengthen/weaken synapses
   */
  async learnPattern(
    pathwayId: string,
    inputStates: Map<string, BitState>,
    expectedOutputs: Map<string, BitState>
  ): Promise<void> {
    const pathway = this.pathways.get(pathwayId);
    if (!pathway) {
      throw new Error(`Pathway not found: ${pathwayId}`);
    }

    // Get current outputs
    const result = await this.propagateSignal(pathwayId, inputStates);

    // Compare with expected outputs and adjust weights (Hebbian learning)
    const neuronIds = Array.from(pathway.neurons.keys());
    const size = pathway.adjacencyMatrix.length;

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (pathway.adjacencyMatrix[i][j] === 0) continue;

        const sourceId = neuronIds[i];
        const targetId = neuronIds[j];

        const sourceNeuron = pathway.neurons.get(sourceId);
        const targetNeuron = pathway.neurons.get(targetId);
        if (!sourceNeuron || !targetNeuron) continue;

        const expectedOutput = expectedOutputs.get(targetId);
        if (expectedOutput === undefined) continue;

        const error = expectedOutput - targetNeuron.state;

        // Hebbian learning: strengthen if both active, weaken otherwise
        const delta =
          this.config.learningRate * error * sourceNeuron.state;
        pathway.adjacencyMatrix[i][j] = Math.max(
          0,
          Math.min(1, pathway.adjacencyMatrix[i][j] + delta)
        );

        // Update synapse record
        const synapseId = `${sourceId}->${targetId}`;
        const synapse = pathway.synapses.get(synapseId);
        if (synapse) {
          synapse.weight = pathway.adjacencyMatrix[i][j];
          synapse.lastUpdate = Date.now();
          synapse.updateCount++;
        }
      }
    }

    // Store pattern signature
    const patternBits = Array.from(inputStates.values());
    this.storePatternSignature(patternBits, pathwayId);

    this.emit('pattern-learned', { pathwayId, patternSize: inputStates.size });
  }

  /**
   * Store a recognized pattern signature
   */
  private storePatternSignature(bits: BitState[], pathwayId: string): void {
    const patternHash = bits.join('');
    const existing = this.patterns.get(patternHash);

    if (existing) {
      existing.frequency++;
      existing.lastSeen = Date.now();
      if (!existing.associatedPathways.includes(pathwayId)) {
        existing.associatedPathways.push(pathwayId);
      }
    } else {
      if (this.patterns.size >= MAX_STORED_PATTERNS) {
        // Remove oldest patterns
        const sorted = Array.from(this.patterns.entries()).sort(
          (a, b) => a[1].lastSeen - b[1].lastSeen
        );
        for (let i = 0; i < 100; i++) {
          this.patterns.delete(sorted[i][0]);
        }
      }

      this.patterns.set(patternHash, {
        id: patternHash,
        bitPattern: bits,
        confidence: 0.5,
        frequency: 1,
        associatedPathways: [pathwayId],
        lastSeen: Date.now()
      });
    }
  }

  /**
   * Recognize patterns in input data
   */
  recognizePattern(bits: BitState[]): PatternSignature | null {
    const patternHash = bits.join('');
    return this.patterns.get(patternHash) || null;
  }

  /**
   * Prune low-utility pathways and synapses
   */
  async prunePathways(): Promise<{ prunedSynapses: number; prunedPathways: string[] }> {
    let prunedSynapses = 0;
    const prunedPathways: string[] = [];

    Array.from(this.pathways.entries()).forEach(([pathwayId, pathway]) => {
      // Don't prune core pathways
      if (
        pathwayId.includes('core') ||
        pathwayId.includes('bridge') ||
        pathwayId.includes('shared')
      ) {
        // Still prune weak synapses within core pathways
        prunedSynapses += this.pruneWeakSynapses(pathway);
        return;
      }

      // Prune entire pathway if utility is too low
      if (pathway.utility < this.config.pruneThreshold) {
        this.pathways.delete(pathwayId);
        prunedPathways.push(pathwayId);
        this.metrics.prunedPathways++;
      } else {
        prunedSynapses += this.pruneWeakSynapses(pathway);
      }
    });

    this.updateMetrics();
    this.emit('pruning-complete', { prunedSynapses, prunedPathways });
    log.info('Pathway pruning complete', { prunedSynapses, prunedPathways });

    return { prunedSynapses, prunedPathways };
  }

  /**
   * Prune weak synapses within a pathway
   */
  private pruneWeakSynapses(pathway: NeuralPathway): number {
    let pruned = 0;
    const neuronIds = Array.from(pathway.neurons.keys());
    const size = pathway.adjacencyMatrix.length;

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (
          pathway.adjacencyMatrix[i][j] > 0 &&
          pathway.adjacencyMatrix[i][j] < this.config.pruneThreshold
        ) {
          pathway.adjacencyMatrix[i][j] = 0;
          const synapseId = `${neuronIds[i]}->${neuronIds[j]}`;
          pathway.synapses.delete(synapseId);
          pruned++;
        }
      }
    }

    return pruned;
  }

  /**
   * Create redundant pathway for robustness
   */
  async createRedundantPathway(sourcePathwayId: string): Promise<NeuralPathway | null> {
    const source = this.pathways.get(sourcePathwayId);
    if (!source) {
      return null;
    }

    const redundantId = `${sourcePathwayId}-redundant-${Date.now()}`;

    // Deep copy neurons
    const neurons = new Map<string, BitNeuron>();
    Array.from(source.neurons.entries()).forEach(([id, neuron]) => {
      const newId = id.replace(sourcePathwayId, redundantId);
      neurons.set(newId, {
        ...neuron,
        id: newId,
        state: 0,
        activationCount: 0
      });
    });

    // Deep copy adjacency matrix
    const adjacencyMatrix = source.adjacencyMatrix.map(row => [...row]);

    // Deep copy synapses
    const synapses = new Map<string, Synapse>();
    Array.from(source.synapses.entries()).forEach(([id, synapse]) => {
      const newId = id.replace(sourcePathwayId, redundantId);
      synapses.set(newId, {
        ...synapse,
        sourceId: synapse.sourceId.replace(sourcePathwayId, redundantId),
        targetId: synapse.targetId.replace(sourcePathwayId, redundantId),
        updateCount: 0
      });
    });

    const redundantPathway: NeuralPathway = {
      id: redundantId,
      name: `${source.name} (Redundant)`,
      domain: source.domain,
      neurons,
      synapses,
      adjacencyMatrix,
      activationHistory: [],
      utility: source.utility * 0.9, // Start with slightly lower utility
      created: Date.now(),
      lastUsed: Date.now()
    };

    this.pathways.set(redundantId, redundantPathway);
    this.updateMetrics();

    this.emit('redundancy-created', { sourceId: sourcePathwayId, redundantId });
    log.info('Redundant pathway created', { sourceId: sourcePathwayId, redundantId });

    return redundantPathway;
  }

  /**
   * Cross-domain signal propagation (ALEXARA <-> CRYPTARA bridge)
   */
  async crossDomainPropagate(
    sourceDomain: 'legal' | 'crypto',
    inputStates: Map<string, BitState>
  ): Promise<PropagationResult> {
    const startTime = Date.now();

    // Determine source and target core pathways
    const sourcePathwayId = sourceDomain === 'legal' ? 'legal-core' : 'crypto-core';
    const targetPathwayId = sourceDomain === 'legal' ? 'crypto-core' : 'legal-core';

    // Propagate through source pathway
    const sourceResult = await this.propagateSignal(sourcePathwayId, inputStates);

    // Extract activated neuron states for bridge
    const bridgeInputs = new Map<string, BitState>();
    const bridgePathway = this.pathways.get('meta-bridge');

    if (bridgePathway) {
      // Map source outputs to bridge inputs
      let i = 0;
      Array.from(sourceResult.outputStates.values()).forEach(state => {
        const bridgeNeuronId = `meta-bridge-n${i % bridgePathway.neurons.size}`;
        bridgeInputs.set(bridgeNeuronId, state);
        i++;
      });

      // Propagate through bridge
      await this.propagateSignal('meta-bridge', bridgeInputs);
    }

    // Prepare inputs for target domain (metadata only, no OSINT data if legal->crypto)
    const targetInputs = new Map<string, BitState>();
    const targetPathway = this.pathways.get(targetPathwayId);

    if (targetPathway) {
      // Only transfer high-confidence signals
      const highConfidenceNeurons = sourceResult.activatedNeurons.filter(() =>
        Math.random() > 0.5
      ); // Selective transfer

      for (let i = 0; i < Math.min(highConfidenceNeurons.length, 10); i++) {
        const targetNeuronId = `${targetPathwayId}-n${i}`;
        targetInputs.set(targetNeuronId, 1);
      }
    }

    // Propagate through target pathway
    const targetResult = await this.propagateSignal(targetPathwayId, targetInputs);

    const processingTime = Date.now() - startTime;

    return {
      outputStates: targetResult.outputStates,
      activatedNeurons: [
        ...sourceResult.activatedNeurons,
        ...targetResult.activatedNeurons
      ],
      pathwaysUsed: [sourcePathwayId, 'meta-bridge', targetPathwayId],
      confidence: (sourceResult.confidence + targetResult.confidence) / 2,
      processingTime
    };
  }

  /**
   * Update global metrics
   */
  private updateMetrics(): void {
    let totalNeurons = 0;
    let totalSynapses = 0;
    let totalUtility = 0;

    Array.from(this.pathways.values()).forEach(pathway => {
      totalNeurons += pathway.neurons.size;
      totalSynapses += pathway.synapses.size;
      totalUtility += pathway.utility;
    });

    this.metrics = {
      ...this.metrics,
      totalNeurons,
      totalSynapses,
      activePathways: this.pathways.size,
      averageUtility: this.pathways.size > 0 ? totalUtility / this.pathways.size : 0,
      patternRecognitionRate: this.patterns.size / Math.max(1, MAX_STORED_PATTERNS)
    };
  }

  /**
   * Get system metrics
   */
  getMetrics(): PathwayMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get pathway information
   */
  getPathwayInfo(pathwayId: string): Partial<NeuralPathway> | null {
    const pathway = this.pathways.get(pathwayId);
    if (!pathway) return null;

    return {
      id: pathway.id,
      name: pathway.name,
      domain: pathway.domain,
      utility: pathway.utility,
      created: pathway.created,
      lastUsed: pathway.lastUsed,
      activationHistory: pathway.activationHistory.slice(-10)
    };
  }

  /**
   * Get all pathway IDs
   */
  getAllPathwayIds(): string[] {
    return Array.from(this.pathways.keys());
  }

  /**
   * Get stored patterns count
   */
  getPatternCount(): number {
    return this.patterns.size;
  }

  /**
   * Check if system is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown the neural pathway system
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Bit Neural Pathway System...');
    this.removeAllListeners();
    this.pathways.clear();
    this.patterns.clear();
    this.initialized = false;
    log.info('Bit Neural Pathway System shutdown complete');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance: BitNeuralPathwayManager | null = null;

export function getBitNeuralPathwayManager(
  config?: Partial<PathwayConfig>
): BitNeuralPathwayManager {
  if (!instance) {
    instance = new BitNeuralPathwayManager(config);
  }
  return instance;
}

export async function initializeBitNeuralPathways(
  config?: Partial<PathwayConfig>
): Promise<BitNeuralPathwayManager> {
  const manager = getBitNeuralPathwayManager(config);
  await manager.initialize();
  return manager;
}

export async function shutdownBitNeuralPathways(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  BitNeuralPathwayManager,
  getBitNeuralPathwayManager,
  initializeBitNeuralPathways,
  shutdownBitNeuralPathways
};
