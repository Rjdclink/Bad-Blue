/**
 * ALEXARA Module - Left Brain Legal Core
 * 
 * Legal reasoning neurons with infinite instantiation capability.
 * Cross-domain inference clusters that can borrow pathways from CRYPTARA
 * without crossover of OSINT forbidden areas.
 * 
 * Features:
 * - Legal reasoning neural clusters
 * - Case law pattern recognition
 * - Statutory interpretation pathways
 * - Dynamic pathway allocation for legal analysis
 * - Integration with 4JI Orchestrator
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import {
  BitNeuralPathwayManager,
  getBitNeuralPathwayManager,
  BitState,
  PropagationResult,
  NeuralPathway
} from './bitNeuralPathways';

const log = createLogger('ALEXARA');

// ============================================================================
// CONSTANTS
// ============================================================================

const LEGAL_REASONING_NEURONS = 128;
const CASE_PATTERN_NEURONS = 64;
const STATUTORY_NEURONS = 64;
const MAX_LEGAL_CLUSTERS = 50;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface LegalReasoningCluster {
  id: string;
  name: string;
  lawType: string;
  jurisdiction: string;
  pathwayId: string;
  confidence: number;
  lastUsed: number;
  usageCount: number;
  elements: LegalElement[];
}

export interface LegalElement {
  id: string;
  type: 'cause_of_action' | 'defense' | 'element' | 'remedy' | 'precedent';
  name: string;
  bitPattern: BitState[];
  weight: number;
}

export interface LegalAnalysisResult {
  clusterId: string;
  lawType: string;
  jurisdiction: string;
  causesOfAction: string[];
  defenses: string[];
  requiredElements: string[];
  potentialRemedies: string[];
  confidence: number;
  precedentPatterns: string[];
  processingTime: number;
}

export interface ALEXARAMetrics {
  totalClusters: number;
  activeClusters: number;
  totalAnalyses: number;
  averageConfidence: number;
  patternMatchRate: number;
  crossDomainQueries: number;
}

// ============================================================================
// ALEXARA MODULE
// ============================================================================

export class ALEXARAModule extends EventEmitter {
  private pathwayManager: BitNeuralPathwayManager;
  private clusters: Map<string, LegalReasoningCluster> = new Map();
  private metrics: ALEXARAMetrics;
  private initialized: boolean = false;

  constructor() {
    super();
    this.pathwayManager = getBitNeuralPathwayManager();
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): ALEXARAMetrics {
    return {
      totalClusters: 0,
      activeClusters: 0,
      totalAnalyses: 0,
      averageConfidence: 0,
      patternMatchRate: 0,
      crossDomainQueries: 0
    };
  }

  /**
   * Initialize ALEXARA module
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('Initializing ALEXARA (Left Brain Legal Core)...');

    // Ensure pathway manager is initialized
    if (!this.pathwayManager.isInitialized()) {
      await this.pathwayManager.initialize();
    }

    // Create core legal pathways
    await this.pathwayManager.createPathway(
      'alexara-reasoning',
      'ALEXARA Legal Reasoning',
      'legal',
      LEGAL_REASONING_NEURONS
    );

    await this.pathwayManager.createPathway(
      'alexara-case-patterns',
      'ALEXARA Case Pattern Recognition',
      'legal',
      CASE_PATTERN_NEURONS
    );

    await this.pathwayManager.createPathway(
      'alexara-statutes',
      'ALEXARA Statutory Interpretation',
      'legal',
      STATUTORY_NEURONS
    );

    // Pre-create clusters for common law types
    await this.createLegalCluster('civil-rights', 'Civil Rights Violations', 'Federal');
    await this.createLegalCluster('contract', 'Contract Law', 'State');
    await this.createLegalCluster('tort', 'Tort Claims', 'State');
    await this.createLegalCluster('employment', 'Employment Law', 'Federal');
    await this.createLegalCluster('family', 'Family Law', 'State');

    this.initialized = true;
    this.emit('initialized', { clusters: this.clusters.size });
    log.info('ALEXARA initialized', { clusters: this.clusters.size });
  }

  /**
   * Create a new legal reasoning cluster
   */
  async createLegalCluster(
    lawType: string,
    name: string,
    jurisdiction: string
  ): Promise<LegalReasoningCluster> {
    const clusterId = `legal-${lawType}-${jurisdiction.toLowerCase()}`;

    if (this.clusters.has(clusterId)) {
      return this.clusters.get(clusterId)!;
    }

    // Check cluster limit
    if (this.clusters.size >= MAX_LEGAL_CLUSTERS) {
      // Remove least used cluster
      const sortedClusters = Array.from(this.clusters.values()).sort(
        (a, b) => a.lastUsed - b.lastUsed
      );
      if (sortedClusters.length > 0) {
        this.clusters.delete(sortedClusters[0].id);
      }
    }

    // Create dedicated pathway for this cluster
    const pathwayId = `alexara-cluster-${clusterId}`;
    await this.pathwayManager.createPathway(pathwayId, name, 'legal', 32);

    const cluster: LegalReasoningCluster = {
      id: clusterId,
      name,
      lawType,
      jurisdiction,
      pathwayId,
      confidence: 0.5,
      lastUsed: Date.now(),
      usageCount: 0,
      elements: []
    };

    this.clusters.set(clusterId, cluster);
    this.updateMetrics();

    this.emit('cluster-created', { clusterId, lawType, jurisdiction });
    log.info('Legal cluster created', { clusterId, lawType, jurisdiction });

    return cluster;
  }

  /**
   * Analyze legal situation using neural pathways
   */
  async analyzeLegalSituation(
    situation: string,
    lawType: string,
    jurisdiction: string
  ): Promise<LegalAnalysisResult> {
    const startTime = Date.now();

    // Get or create appropriate cluster
    const clusterId = `legal-${lawType}-${jurisdiction.toLowerCase()}`;
    let cluster = this.clusters.get(clusterId);

    if (!cluster) {
      cluster = await this.createLegalCluster(lawType, `${lawType} Analysis`, jurisdiction);
    }

    cluster.lastUsed = Date.now();
    cluster.usageCount++;

    // Encode situation into bit patterns
    const inputStates = this.encodeSituation(situation);

    // Propagate through cluster pathway
    const clusterResult = await this.pathwayManager.propagateSignal(
      cluster.pathwayId,
      inputStates
    );

    // Propagate through main reasoning pathway
    const reasoningResult = await this.pathwayManager.propagateSignal(
      'alexara-reasoning',
      inputStates
    );

    // Propagate through case pattern pathway
    const casePatternResult = await this.pathwayManager.propagateSignal(
      'alexara-case-patterns',
      inputStates
    );

    // Decode results into legal elements
    const causesOfAction = this.decodeCausesOfAction(clusterResult, lawType);
    const defenses = this.decodeDefenses(clusterResult, lawType);
    const requiredElements = this.decodeRequiredElements(reasoningResult, lawType);
    const potentialRemedies = this.decodeRemedies(reasoningResult, lawType);
    const precedentPatterns = this.decodePrecedents(casePatternResult, lawType);

    // Calculate overall confidence
    const confidence =
      (clusterResult.confidence + reasoningResult.confidence + casePatternResult.confidence) / 3;

    // Update cluster confidence based on result
    cluster.confidence = cluster.confidence * 0.9 + confidence * 0.1;

    // Learn from this analysis
    await this.learnFromAnalysis(cluster, inputStates, confidence);

    this.metrics.totalAnalyses++;
    this.updateMetrics();

    const processingTime = Date.now() - startTime;

    const result: LegalAnalysisResult = {
      clusterId: cluster.id,
      lawType,
      jurisdiction,
      causesOfAction,
      defenses,
      requiredElements,
      potentialRemedies,
      confidence,
      precedentPatterns,
      processingTime
    };

    this.emit('analysis-complete', result);
    log.info('Legal analysis complete', {
      clusterId: cluster.id,
      confidence,
      processingTime
    });

    return result;
  }

  /**
   * Encode situation text into bit states
   */
  private encodeSituation(situation: string): Map<string, BitState> {
    const inputStates = new Map<string, BitState>();
    const words = situation.toLowerCase().split(/\s+/);

    // Create bit patterns based on word hashing
    for (let i = 0; i < Math.min(words.length, 64); i++) {
      const word = words[i];
      const hash = this.simpleHash(word);
      const neuronId = `alexara-reasoning-n${hash % LEGAL_REASONING_NEURONS}`;
      inputStates.set(neuronId, 1);
    }

    // Add legal keyword activations
    const legalKeywords = [
      'damages',
      'breach',
      'negligence',
      'liability',
      'violation',
      'rights',
      'injury',
      'harm',
      'duty',
      'contract'
    ];

    for (const keyword of legalKeywords) {
      if (situation.toLowerCase().includes(keyword)) {
        const hash = this.simpleHash(keyword);
        const neuronId = `alexara-reasoning-n${hash % LEGAL_REASONING_NEURONS}`;
        inputStates.set(neuronId, 1);
      }
    }

    return inputStates;
  }

  /**
   * Simple hash function for words
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
   * Decode causes of action from propagation result
   */
  private decodeCausesOfAction(result: PropagationResult, lawType: string): string[] {
    const causes: string[] = [];
    const activationRate = result.activatedNeurons.length / 32;

    // Map activation patterns to causes of action
    if (activationRate > 0.3) {
      if (lawType.includes('civil-rights') || lawType.includes('civil_rights')) {
        causes.push('42 U.S.C. § 1983 - Deprivation of Rights');
        if (activationRate > 0.5) {
          causes.push('Fourth Amendment Violation');
        }
      } else if (lawType.includes('tort')) {
        causes.push('Negligence');
        if (activationRate > 0.5) {
          causes.push('Intentional Infliction of Emotional Distress');
        }
      } else if (lawType.includes('contract')) {
        causes.push('Breach of Contract');
      } else if (lawType.includes('employment')) {
        causes.push('Wrongful Termination');
      }
    }

    return causes;
  }

  /**
   * Decode defenses from propagation result
   */
  private decodeDefenses(result: PropagationResult, lawType: string): string[] {
    const defenses: string[] = [];
    const activationRate = result.activatedNeurons.length / 32;

    if (activationRate > 0.2) {
      if (lawType.includes('civil-rights')) {
        defenses.push('Qualified Immunity');
      } else if (lawType.includes('tort')) {
        defenses.push('Contributory Negligence');
      } else if (lawType.includes('contract')) {
        defenses.push('Impossibility of Performance');
      }
    }

    return defenses;
  }

  /**
   * Decode required elements from propagation result
   */
  private decodeRequiredElements(result: PropagationResult, lawType: string): string[] {
    const elements: string[] = [];

    if (lawType.includes('civil-rights')) {
      elements.push('Action under color of state law');
      elements.push('Deprivation of federal right');
      elements.push('Causal connection');
    } else if (lawType.includes('negligence') || lawType.includes('tort')) {
      elements.push('Duty of care');
      elements.push('Breach of duty');
      elements.push('Causation');
      elements.push('Damages');
    }

    return elements;
  }

  /**
   * Decode remedies from propagation result
   */
  private decodeRemedies(result: PropagationResult, lawType: string): string[] {
    const remedies: string[] = [];
    const confidence = result.confidence;

    if (confidence > 0.3) {
      remedies.push('Compensatory Damages');
      if (confidence > 0.5) {
        remedies.push('Injunctive Relief');
      }
      if (confidence > 0.7) {
        remedies.push('Punitive Damages');
      }
    }

    return remedies;
  }

  /**
   * Decode precedent patterns from propagation result
   */
  private decodePrecedents(result: PropagationResult, lawType: string): string[] {
    const precedents: string[] = [];

    if (result.confidence > 0.4) {
      if (lawType.includes('civil-rights')) {
        precedents.push('Monell v. Department of Social Services');
        precedents.push('Graham v. Connor');
      } else if (lawType.includes('contract')) {
        precedents.push('Hadley v. Baxendale');
      }
    }

    return precedents;
  }

  /**
   * Learn from analysis results
   */
  private async learnFromAnalysis(
    cluster: LegalReasoningCluster,
    inputStates: Map<string, BitState>,
    confidence: number
  ): Promise<void> {
    if (confidence > 0.7) {
      // High confidence result - reinforce pathway
      const expectedOutputs = new Map<string, BitState>();

      // Set expected outputs based on activated inputs
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
   * Query CRYPTARA for cross-domain insights (metadata only)
   */
  async queryCryptaraMetadata(lawType: string): Promise<{ patterns: string[]; confidence: number }> {
    this.metrics.crossDomainQueries++;

    // Use cross-domain propagation through meta-bridge
    const inputStates = new Map<string, BitState>();
    const hash = this.simpleHash(lawType);
    inputStates.set(`legal-core-n${hash % 64}`, 1);

    const result = await this.pathwayManager.crossDomainPropagate('legal', inputStates);

    return {
      patterns: result.activatedNeurons.slice(0, 5).map(n => `pattern-${n}`),
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
    ).length; // Active in last hour

    const totalConfidence = clusterArray.reduce((sum, c) => sum + c.confidence, 0);

    this.metrics = {
      ...this.metrics,
      totalClusters: this.clusters.size,
      activeClusters: activeNow,
      averageConfidence:
        this.clusters.size > 0 ? totalConfidence / this.clusters.size : 0,
      patternMatchRate: this.pathwayManager.getPatternCount() / 1000
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): ALEXARAMetrics {
    this.updateMetrics();
    return { ...this.metrics };
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
   * Shutdown ALEXARA module
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down ALEXARA module...');
    this.removeAllListeners();
    this.clusters.clear();
    this.initialized = false;
    log.info('ALEXARA shutdown complete');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let alexaraInstance: ALEXARAModule | null = null;

export function getALEXARA(): ALEXARAModule {
  if (!alexaraInstance) {
    alexaraInstance = new ALEXARAModule();
  }
  return alexaraInstance;
}

export async function initializeALEXARA(): Promise<ALEXARAModule> {
  const alexara = getALEXARA();
  await alexara.initialize();
  return alexara;
}

export async function shutdownALEXARA(): Promise<void> {
  if (alexaraInstance) {
    await alexaraInstance.shutdown();
    alexaraInstance = null;
  }
}

export default {
  ALEXARAModule,
  getALEXARA,
  initializeALEXARA,
  shutdownALEXARA
};
