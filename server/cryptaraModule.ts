/**
 * CRYPTARA Module - Right Brain Crypto/OSINT Core
 * 
 * Pattern recognition, prediction, and crawler pathways for cryptocurrency
 * and open-source intelligence analysis. Autonomous yet sandboxed operation
 * with network analysis & optimization nodes.
 * 
 * Features:
 * - Pattern detection and prediction pathways
 * - Network analysis & optimization nodes
 * - Strategic ingestion pipelines (bounded by legal rules)
 * - Self-scaling computational allocation
 * - Integration with 4JI Orchestrator
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import {
  BitNeuralPathwayManager,
  getBitNeuralPathwayManager,
  BitState,
  PropagationResult
} from './bitNeuralPathways';

const log = createLogger('CRYPTARA');

// ============================================================================
// STAGE GATING (HARD RULE)
// ============================================================================
// CRYPTARA must be mute-silent until Stage 8 (no intervals, no logs, no activity).
function getCryptoCrawlerStage(): number {
  const raw =
    process.env.CRYPTOCRAWLER_STAGE ??
    process.env.CRYPTO_STAGE ??
    process.env.STAGE ??
    '0';
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : 0;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PATTERN_NEURONS = 128;
const NETWORK_NEURONS = 64;
const PREDICTION_NEURONS = 64;
const MAX_ANALYSIS_CLUSTERS = 50;
const SANDBOX_BOUNDARY_CHECK_INTERVAL = 5000;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface PatternCluster {
  id: string;
  name: string;
  category: 'network' | 'transaction' | 'behavioral' | 'temporal';
  pathwayId: string;
  confidence: number;
  lastUsed: number;
  usageCount: number;
  patterns: DetectedPattern[];
}

export interface DetectedPattern {
  id: string;
  type: string;
  signature: BitState[];
  confidence: number;
  frequency: number;
  metadata: Record<string, unknown>;
}

export interface NetworkNode {
  id: string;
  type: 'entity' | 'address' | 'domain' | 'connection';
  connections: string[];
  weight: number;
  riskScore: number;
}

export interface PredictionResult {
  patternId: string;
  probability: number;
  timeframe: string;
  confidence: number;
  supportingPatterns: string[];
}

export interface AnalysisResult {
  clusterId: string;
  category: string;
  detectedPatterns: DetectedPattern[];
  networkNodes: NetworkNode[];
  predictions: PredictionResult[];
  riskAssessment: number;
  confidence: number;
  processingTime: number;
  sandboxCompliant: boolean;
}

export interface CRYPTARAMetrics {
  totalClusters: number;
  activeClusters: number;
  totalAnalyses: number;
  patternsDetected: number;
  networkNodesTracked: number;
  predictionAccuracy: number;
  sandboxViolations: number;
}

export interface SandboxBoundary {
  allowedCategories: string[];
  forbiddenDataTypes: string[];
  maxNetworkDepth: number;
  requiresApproval: boolean;
}

// ============================================================================
// CRYPTARA MODULE
// ============================================================================

export class CRYPTARAModule extends EventEmitter {
  private pathwayManager: BitNeuralPathwayManager;
  private clusters: Map<string, PatternCluster> = new Map();
  private networkNodes: Map<string, NetworkNode> = new Map();
  private metrics: CRYPTARAMetrics;
  private sandboxBoundary: SandboxBoundary;
  private initialized: boolean = false;
  private boundaryCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.pathwayManager = getBitNeuralPathwayManager();
    this.metrics = this.initializeMetrics();
    this.sandboxBoundary = this.initializeSandboxBoundary();
  }

  private initializeMetrics(): CRYPTARAMetrics {
    return {
      totalClusters: 0,
      activeClusters: 0,
      totalAnalyses: 0,
      patternsDetected: 0,
      networkNodesTracked: 0,
      predictionAccuracy: 0.5,
      sandboxViolations: 0
    };
  }

  private initializeSandboxBoundary(): SandboxBoundary {
    return {
      allowedCategories: ['network', 'transaction', 'behavioral', 'temporal'],
      forbiddenDataTypes: ['pii', 'classified', 'restricted_osint'],
      maxNetworkDepth: 3,
      requiresApproval: false
    };
  }

  /**
   * Initialize CRYPTARA module
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // HARD RULE: mute-silent until Stage 8.
    // Do not log, do not create timers, do not initialize pathways.
    if (getCryptoCrawlerStage() < 8) {
      return;
    }

    log.info('Initializing CRYPTARA (Right Brain Crypto/OSINT Core)...');

    // Ensure pathway manager is initialized
    if (!this.pathwayManager.isInitialized()) {
      await this.pathwayManager.initialize();
    }

    // Create core crypto pathways
    await this.pathwayManager.createPathway(
      'cryptara-patterns',
      'CRYPTARA Pattern Detection',
      'crypto',
      PATTERN_NEURONS
    );

    await this.pathwayManager.createPathway(
      'cryptara-network',
      'CRYPTARA Network Analysis',
      'crypto',
      NETWORK_NEURONS
    );

    await this.pathwayManager.createPathway(
      'cryptara-prediction',
      'CRYPTARA Prediction Engine',
      'crypto',
      PREDICTION_NEURONS
    );

    // Pre-create clusters for common analysis types
    await this.createPatternCluster('tx-patterns', 'Transaction Patterns', 'transaction');
    await this.createPatternCluster('net-topology', 'Network Topology', 'network');
    await this.createPatternCluster('behavior-analysis', 'Behavioral Analysis', 'behavioral');
    await this.createPatternCluster('temporal-trends', 'Temporal Trends', 'temporal');

    // Start sandbox boundary monitoring
    this.startBoundaryMonitoring();

    this.initialized = true;
    this.emit('initialized', { clusters: this.clusters.size });
    log.info('CRYPTARA initialized', { clusters: this.clusters.size });
  }

  /**
   * Start continuous sandbox boundary monitoring
   */
  private startBoundaryMonitoring(): void {
    // HARD RULE: mute-silent until Stage 8.
    if (getCryptoCrawlerStage() < 8) return;

    if (this.boundaryCheckInterval) {
      clearInterval(this.boundaryCheckInterval);
    }

    this.boundaryCheckInterval = setInterval(() => {
      this.checkSandboxCompliance();
    }, SANDBOX_BOUNDARY_CHECK_INTERVAL);
  }

  /**
   * Check sandbox compliance
   */
  private checkSandboxCompliance(): void {
    let violations = 0;

    // Check network depth compliance
    Array.from(this.networkNodes.values()).forEach(node => {
      if (node.connections.length > this.sandboxBoundary.maxNetworkDepth * 10) {
        violations++;
        // Prune excessive connections
        node.connections = node.connections.slice(0, this.sandboxBoundary.maxNetworkDepth * 10);
      }
    });

    if (violations > 0) {
      this.metrics.sandboxViolations += violations;
      this.emit('sandbox-violation', { violations, corrected: true });
      log.warn('Sandbox violations detected and corrected', { violations });
    }
  }

  /**
   * Create a new pattern cluster
   */
  async createPatternCluster(
    id: string,
    name: string,
    category: PatternCluster['category']
  ): Promise<PatternCluster> {
    const clusterId = `crypto-${id}`;

    if (this.clusters.has(clusterId)) {
      return this.clusters.get(clusterId)!;
    }

    // Check cluster limit
    if (this.clusters.size >= MAX_ANALYSIS_CLUSTERS) {
      const sortedClusters = Array.from(this.clusters.values()).sort(
        (a, b) => a.lastUsed - b.lastUsed
      );
      if (sortedClusters.length > 0) {
        this.clusters.delete(sortedClusters[0].id);
      }
    }

    // Validate category is allowed
    if (!this.sandboxBoundary.allowedCategories.includes(category)) {
      throw new Error(`Category ${category} is not allowed in sandbox`);
    }

    // Create dedicated pathway for this cluster
    const pathwayId = `cryptara-cluster-${clusterId}`;
    await this.pathwayManager.createPathway(pathwayId, name, 'crypto', 32);

    const cluster: PatternCluster = {
      id: clusterId,
      name,
      category,
      pathwayId,
      confidence: 0.5,
      lastUsed: Date.now(),
      usageCount: 0,
      patterns: []
    };

    this.clusters.set(clusterId, cluster);
    this.updateMetrics();

    this.emit('cluster-created', { clusterId, category });
    log.info('Pattern cluster created', { clusterId, category });

    return cluster;
  }

  /**
   * Analyze data patterns using neural pathways
   */
  async analyzePatterns(
    data: Record<string, unknown>,
    category: PatternCluster['category']
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    // Validate data doesn't contain forbidden types
    if (!this.validateDataSandbox(data)) {
      this.metrics.sandboxViolations++;
      throw new Error('Data contains forbidden types - sandbox violation');
    }

    // Get or create appropriate cluster
    const clusterId = `crypto-${category}-analysis`;
    let cluster = this.clusters.get(clusterId);

    if (!cluster) {
      cluster = await this.createPatternCluster(`${category}-analysis`, `${category} Analysis`, category);
    }

    cluster.lastUsed = Date.now();
    cluster.usageCount++;

    // Encode data into bit patterns
    const inputStates = this.encodeData(data);

    // Propagate through cluster pathway
    const clusterResult = await this.pathwayManager.propagateSignal(
      cluster.pathwayId,
      inputStates
    );

    // Propagate through pattern detection pathway
    const patternResult = await this.pathwayManager.propagateSignal(
      'cryptara-patterns',
      inputStates
    );

    // Propagate through network analysis pathway
    const networkResult = await this.pathwayManager.propagateSignal(
      'cryptara-network',
      inputStates
    );

    // Propagate through prediction pathway
    const predictionResult = await this.pathwayManager.propagateSignal(
      'cryptara-prediction',
      inputStates
    );

    // Decode results
    const detectedPatterns = this.decodePatterns(patternResult, category);
    const networkNodes = this.decodeNetworkNodes(networkResult);
    const predictions = this.decodePredictions(predictionResult);
    const riskAssessment = this.calculateRiskScore(detectedPatterns, networkNodes);

    // Calculate overall confidence
    const confidence =
      (clusterResult.confidence +
        patternResult.confidence +
        networkResult.confidence +
        predictionResult.confidence) /
      4;

    // Update cluster confidence
    cluster.confidence = cluster.confidence * 0.9 + confidence * 0.1;

    // Store detected patterns
    for (const pattern of detectedPatterns) {
      cluster.patterns.push(pattern);
      if (cluster.patterns.length > 100) {
        cluster.patterns.shift();
      }
    }

    // Learn from analysis
    await this.learnFromAnalysis(cluster, inputStates, confidence);

    this.metrics.totalAnalyses++;
    this.metrics.patternsDetected += detectedPatterns.length;
    this.updateMetrics();

    const processingTime = Date.now() - startTime;

    const result: AnalysisResult = {
      clusterId: cluster.id,
      category,
      detectedPatterns,
      networkNodes,
      predictions,
      riskAssessment,
      confidence,
      processingTime,
      sandboxCompliant: true
    };

    this.emit('analysis-complete', result);
    log.info('Pattern analysis complete', {
      clusterId: cluster.id,
      confidence,
      patternsDetected: detectedPatterns.length,
      processingTime
    });

    return result;
  }

  /**
   * Validate data against sandbox boundaries
   */
  private validateDataSandbox(data: Record<string, unknown>): boolean {
    const dataStr = JSON.stringify(data).toLowerCase();

    for (const forbidden of this.sandboxBoundary.forbiddenDataTypes) {
      if (dataStr.includes(forbidden)) {
        log.warn('Forbidden data type detected', { type: forbidden });
        return false;
      }
    }

    return true;
  }

  /**
   * Encode data into bit states
   */
  private encodeData(data: Record<string, unknown>): Map<string, BitState> {
    const inputStates = new Map<string, BitState>();
    const dataStr = JSON.stringify(data);

    // Create bit patterns based on data hashing
    for (let i = 0; i < Math.min(dataStr.length, 128); i++) {
      const charCode = dataStr.charCodeAt(i);
      const neuronId = `cryptara-patterns-n${charCode % PATTERN_NEURONS}`;
      inputStates.set(neuronId, 1);
    }

    // Add category-specific activations based on keys
    const keys = Object.keys(data);
    for (const key of keys) {
      const hash = this.simpleHash(key);
      const neuronId = `cryptara-patterns-n${hash % PATTERN_NEURONS}`;
      inputStates.set(neuronId, 1);
    }

    return inputStates;
  }

  /**
   * Simple hash function
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Decode patterns from propagation result
   */
  private decodePatterns(
    result: PropagationResult,
    category: string
  ): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const activationRate = result.activatedNeurons.length / PATTERN_NEURONS;

    if (activationRate > 0.1) {
      patterns.push({
        id: `pattern-${Date.now()}-1`,
        type: `${category}-primary`,
        signature: result.activatedNeurons.slice(0, 8).map(() => 1 as BitState),
        confidence: activationRate,
        frequency: 1,
        metadata: { category }
      });
    }

    if (activationRate > 0.3) {
      patterns.push({
        id: `pattern-${Date.now()}-2`,
        type: `${category}-secondary`,
        signature: result.activatedNeurons.slice(0, 16).map(() => 1 as BitState),
        confidence: activationRate * 0.8,
        frequency: 1,
        metadata: { category }
      });
    }

    return patterns;
  }

  /**
   * Decode network nodes from propagation result
   */
  private decodeNetworkNodes(result: PropagationResult): NetworkNode[] {
    const nodes: NetworkNode[] = [];

    for (let i = 0; i < Math.min(result.activatedNeurons.length, 5); i++) {
      const neuronId = result.activatedNeurons[i];
      const nodeId = `node-${neuronId}`;

      if (!this.networkNodes.has(nodeId)) {
        // Calculate deterministic risk score based on neuron ID hash
        const riskSeed = this.simpleHash(neuronId);
        const initialRiskScore = (riskSeed % 100) / 200; // 0 to 0.5 range

        const node: NetworkNode = {
          id: nodeId,
          type: 'entity',
          connections: [],
          weight: result.confidence,
          riskScore: initialRiskScore
        };
        this.networkNodes.set(nodeId, node);
      }

      const node = this.networkNodes.get(nodeId)!;
      node.weight = (node.weight + result.confidence) / 2;

      // Connect to other activated neurons
      for (let j = i + 1; j < Math.min(result.activatedNeurons.length, i + 4); j++) {
        const connectedId = `node-${result.activatedNeurons[j]}`;
        if (!node.connections.includes(connectedId)) {
          node.connections.push(connectedId);
        }
      }

      nodes.push(node);
    }

    this.metrics.networkNodesTracked = this.networkNodes.size;
    return nodes;
  }

  /**
   * Decode predictions from propagation result
   */
  private decodePredictions(result: PropagationResult): PredictionResult[] {
    const predictions: PredictionResult[] = [];

    if (result.confidence > 0.4) {
      predictions.push({
        patternId: `pred-${Date.now()}`,
        probability: result.confidence,
        timeframe: 'short-term',
        confidence: result.confidence * 0.8,
        supportingPatterns: result.activatedNeurons.slice(0, 3)
      });
    }

    if (result.confidence > 0.6) {
      predictions.push({
        patternId: `pred-${Date.now()}-med`,
        probability: result.confidence * 0.7,
        timeframe: 'medium-term',
        confidence: result.confidence * 0.6,
        supportingPatterns: result.activatedNeurons.slice(0, 5)
      });
    }

    return predictions;
  }

  /**
   * Calculate risk score from patterns and nodes
   */
  private calculateRiskScore(
    patterns: DetectedPattern[],
    nodes: NetworkNode[]
  ): number {
    let riskScore = 0;

    // Pattern-based risk
    for (const pattern of patterns) {
      riskScore += pattern.confidence * 0.3;
    }

    // Node-based risk
    for (const node of nodes) {
      riskScore += node.riskScore * 0.2;
    }

    return Math.min(1, Math.max(0, riskScore));
  }

  /**
   * Learn from analysis results
   */
  private async learnFromAnalysis(
    cluster: PatternCluster,
    inputStates: Map<string, BitState>,
    confidence: number
  ): Promise<void> {
    if (confidence > 0.6) {
      const expectedOutputs = new Map<string, BitState>();

      Array.from(inputStates.keys()).forEach(neuronId => {
        expectedOutputs.set(neuronId, 1);
      });

      await this.pathwayManager.learnPattern(
        cluster.pathwayId,
        inputStates,
        expectedOutputs
      );
    }
  }

  /**
   * Share metadata with ALEXARA (legal domain) - metadata only
   */
  async shareMetadataWithALEXARA(): Promise<{ patterns: number; confidence: number }> {
    // Only share non-sensitive metadata
    const metadata = {
      patternsDetected: this.metrics.patternsDetected,
      activeAnalyses: this.metrics.activeClusters,
      confidence: this.metrics.predictionAccuracy
    };

    // Use cross-domain propagation
    const inputStates = new Map<string, BitState>();
    inputStates.set('crypto-core-n0', 1);
    inputStates.set('crypto-core-n1', metadata.patternsDetected > 10 ? 1 : 0);

    const result = await this.pathwayManager.crossDomainPropagate('crypto', inputStates);

    return {
      patterns: metadata.patternsDetected,
      confidence: result.confidence
    };
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    const clusterArray = Array.from(this.clusters.values());
    const activeNow = clusterArray.filter(
      c => Date.now() - c.lastUsed < 3600000
    ).length;

    this.metrics = {
      ...this.metrics,
      totalClusters: this.clusters.size,
      activeClusters: activeNow,
      networkNodesTracked: this.networkNodes.size
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): CRYPTARAMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get sandbox boundary configuration
   */
  getSandboxBoundary(): SandboxBoundary {
    return { ...this.sandboxBoundary };
  }

  /**
   * Update sandbox boundary (requires approval flag)
   */
  updateSandboxBoundary(
    updates: Partial<SandboxBoundary>,
    approved: boolean = false
  ): boolean {
    if (updates.requiresApproval !== undefined && !approved) {
      log.warn('Attempted to modify sandbox without approval');
      return false;
    }

    this.sandboxBoundary = { ...this.sandboxBoundary, ...updates };
    this.emit('sandbox-updated', this.sandboxBoundary);
    log.info('Sandbox boundary updated', { updates });
    return true;
  }

  /**
   * Get all cluster IDs
   */
  getClusterIds(): string[] {
    return Array.from(this.clusters.keys());
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown CRYPTARA module
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down CRYPTARA module...');

    if (this.boundaryCheckInterval) {
      clearInterval(this.boundaryCheckInterval);
      this.boundaryCheckInterval = null;
    }

    this.removeAllListeners();
    this.clusters.clear();
    this.networkNodes.clear();
    this.initialized = false;
    log.info('CRYPTARA shutdown complete');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let cryptaraInstance: CRYPTARAModule | null = null;

export function getCRYPTARA(): CRYPTARAModule {
  if (!cryptaraInstance) {
    cryptaraInstance = new CRYPTARAModule();
  }
  return cryptaraInstance;
}

export async function initializeCRYPTARA(): Promise<CRYPTARAModule> {
  const cryptara = getCRYPTARA();
  // HARD RULE: mute-silent until Stage 8.
  if (getCryptoCrawlerStage() >= 8) {
    await cryptara.initialize();
  }
  return cryptara;
}

export async function shutdownCRYPTARA(): Promise<void> {
  if (cryptaraInstance) {
    await cryptaraInstance.shutdown();
    cryptaraInstance = null;
  }
}

export default {
  CRYPTARAModule,
  getCRYPTARA,
  initializeCRYPTARA,
  shutdownCRYPTARA
};
