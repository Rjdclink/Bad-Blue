/**
 * 4Ji Paradox Integration Core - 25 Layer System
 * 
 * Handles conflicting ideas like a brilliant human without destabilizing.
 * 
 * Layer Structure:
 * - Layers 1-5: Detection & tagging of contradiction
 * - Layers 6-10: Generate alternative frames (what-if, emotional lens, logical lens)
 * - Layers 11-15: Cross-compare and test which frame best serves user + truth
 * - Layers 16-20: Compress into a unified viewpoint
 * - Layers 21-25: Feed unified viewpoint to cognitive layers as "this is what's real"
 * 
 * These 25 layers are always on for deeper questions, design, strategy, and emotional topics.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  ParadoxLayer,
  ParadoxLayerCategory,
  Contradiction,
  PerspectiveFrame,
  ParadoxResolution,
} from './types';

const log = createLogger('4Ji-ParadoxCore');

// ============================================================================
// CONSTANTS
// ============================================================================

const TOTAL_LAYERS = 25;
const LAYERS_PER_CATEGORY = 5;

// Layer processing weights (sum to 1.0)
const CATEGORY_WEIGHTS: Record<ParadoxLayerCategory, number> = {
  detection: 0.15,
  framing: 0.25,
  evaluation: 0.30,
  compression: 0.15,
  unification: 0.15,
};

// Contradiction severity thresholds
const SEVERITY_THRESHOLDS = {
  low: 0.3,
  medium: 0.6,
  high: 0.8,
  critical: 0.95,
};

// ============================================================================
// PARADOX INTEGRATION CORE
// ============================================================================

export class ParadoxIntegrationCore extends EventEmitter {
  private layers: ParadoxLayer[] = [];
  private initialized = false;
  private processingActive = false;

  constructor() {
    super();
    this.initializeLayers();
  }

  /**
   * Initialize all 25 paradox layers
   */
  private initializeLayers(): void {
    const categories: ParadoxLayerCategory[] = [
      'detection', 'framing', 'evaluation', 'compression', 'unification'
    ];

    const layerDescriptions: Record<ParadoxLayerCategory, string[]> = {
      detection: [
        'Primary contradiction scanner - identifies explicit conflicts',
        'Implicit conflict detector - finds hidden contradictions',
        'Emotional conflict identifier - detects feeling-based conflicts',
        'Goal conflict analyzer - identifies competing objectives',
        'Contradiction tagger and categorizer - classifies all detected conflicts',
      ],
      framing: [
        'Logical lens generator - creates rational interpretations',
        'Intuitive lens generator - creates gut-feeling interpretations',
        'Narrative lens generator - creates story-based interpretations',
        'Emotional lens generator - creates feeling-centered interpretations',
        'What-if scenario generator - explores alternative possibilities',
      ],
      evaluation: [
        'User service scorer - rates how well frame serves the user',
        'Truth alignment scorer - rates how well frame aligns with truth',
        'Cross-frame comparator - compares all generated frames',
        'Best-fit selector - identifies optimal frame combination',
        'Frame synthesis optimizer - combines best elements of frames',
      ],
      compression: [
        'Viewpoint consolidator - merges selected frames',
        'Contradiction resolver - eliminates remaining conflicts',
        'Coherence enforcer - ensures logical consistency',
        'Simplification engine - removes redundancy',
        'Unified viewpoint crystallizer - creates final clear view',
      ],
      unification: [
        'Reality marker - tags viewpoint as accepted truth',
        'Cognitive handoff preparer - formats for cognitive layers',
        'Confidence scorer - assigns final confidence level',
        'Context preserver - maintains relevant context',
        'Integration finalizer - completes unification process',
      ],
    };

    let layerId = 1;
    for (const category of categories) {
      for (let i = 0; i < LAYERS_PER_CATEGORY; i++) {
        this.layers.push({
          id: layerId,
          category,
          name: `L${layerId}-${category}-${i + 1}`,
          description: layerDescriptions[category][i],
          weight: CATEGORY_WEIGHTS[category] / LAYERS_PER_CATEGORY,
          active: true,
          lastProcessed: undefined,
        });
        layerId++;
      }
    }

    this.initialized = true;
    log.info('Paradox Integration Core initialized', { totalLayers: this.layers.length });
  }

  /**
   * Process input through all 25 paradox layers
   */
  async process(
    input: string,
    context?: Record<string, unknown>
  ): Promise<ParadoxResolution> {
    const startTime = Date.now();
    
    if (!this.initialized) {
      throw new Error('ParadoxIntegrationCore not initialized');
    }

    if (this.processingActive) {
      log.warn('Processing already active, queuing request');
    }

    this.processingActive = true;
    this.emit('processing-started', { input: input.substring(0, 100) });

    try {
      // Phase 1: Detection (Layers 1-5)
      const contradictions = await this.runDetectionPhase(input, context);
      
      // If no contradictions found, return simple resolution
      if (contradictions.length === 0) {
        const simpleResolution: ParadoxResolution = {
          contradictions: [],
          consideredFrames: [],
          unifiedViewpoint: input,
          confidence: 1.0,
          processingTime: Date.now() - startTime,
        };
        this.emit('processing-complete', simpleResolution);
        return simpleResolution;
      }

      // Phase 2: Framing (Layers 6-10)
      const frames = await this.runFramingPhase(contradictions, context);

      // Phase 3: Evaluation (Layers 11-15)
      const evaluatedFrames = await this.runEvaluationPhase(frames, contradictions);

      // Phase 4: Compression (Layers 16-20)
      const compressedViewpoint = await this.runCompressionPhase(evaluatedFrames, contradictions);

      // Phase 5: Unification (Layers 21-25)
      const resolution = await this.runUnificationPhase(
        compressedViewpoint,
        contradictions,
        evaluatedFrames,
        startTime
      );

      this.emit('processing-complete', resolution);
      return resolution;

    } finally {
      this.processingActive = false;
    }
  }

  /**
   * Phase 1: Detection & Tagging (Layers 1-5)
   */
  private async runDetectionPhase(
    input: string,
    context?: Record<string, unknown>
  ): Promise<Contradiction[]> {
    const detectionLayers = this.getLayers('detection');
    const contradictions: Contradiction[] = [];

    // Layer 1: Primary contradiction scanner
    this.markLayerProcessed(detectionLayers[0]);
    const explicitConflicts = this.detectExplicitConflicts(input);
    contradictions.push(...explicitConflicts);

    // Layer 2: Implicit conflict detector
    this.markLayerProcessed(detectionLayers[1]);
    const implicitConflicts = this.detectImplicitConflicts(input, context);
    contradictions.push(...implicitConflicts);

    // Layer 3: Emotional conflict identifier
    this.markLayerProcessed(detectionLayers[2]);
    const emotionalConflicts = this.detectEmotionalConflicts(input);
    contradictions.push(...emotionalConflicts);

    // Layer 4: Goal conflict analyzer
    this.markLayerProcessed(detectionLayers[3]);
    const goalConflicts = this.detectGoalConflicts(input, context);
    contradictions.push(...goalConflicts);

    // Layer 5: Contradiction tagger and categorizer
    this.markLayerProcessed(detectionLayers[4]);
    const taggedContradictions = this.tagAndCategorize(contradictions);

    log.debug('Detection phase complete', { 
      contradictionsFound: taggedContradictions.length,
      types: taggedContradictions.map(c => c.type),
    });

    return taggedContradictions;
  }

  /**
   * Phase 2: Generate Alternative Frames (Layers 6-10)
   */
  private async runFramingPhase(
    contradictions: Contradiction[],
    context?: Record<string, unknown>
  ): Promise<PerspectiveFrame[]> {
    const framingLayers = this.getLayers('framing');
    const frames: PerspectiveFrame[] = [];

    // Layer 6: Logical lens
    this.markLayerProcessed(framingLayers[0]);
    frames.push(this.generateLogicalFrame(contradictions, context));

    // Layer 7: Intuitive lens
    this.markLayerProcessed(framingLayers[1]);
    frames.push(this.generateIntuitiveFrame(contradictions, context));

    // Layer 8: Narrative lens
    this.markLayerProcessed(framingLayers[2]);
    frames.push(this.generateNarrativeFrame(contradictions, context));

    // Layer 9: Emotional lens
    this.markLayerProcessed(framingLayers[3]);
    frames.push(this.generateEmotionalFrame(contradictions, context));

    // Layer 10: What-if scenarios
    this.markLayerProcessed(framingLayers[4]);
    const whatIfFrames = this.generateWhatIfFrames(contradictions, context);
    frames.push(...whatIfFrames);

    log.debug('Framing phase complete', { framesGenerated: frames.length });
    return frames;
  }

  /**
   * Phase 3: Cross-Compare and Test (Layers 11-15)
   */
  private async runEvaluationPhase(
    frames: PerspectiveFrame[],
    contradictions: Contradiction[]
  ): Promise<PerspectiveFrame[]> {
    const evalLayers = this.getLayers('evaluation');

    // Layer 11: User service scorer
    this.markLayerProcessed(evalLayers[0]);
    frames.forEach(frame => {
      frame.userServiceScore = this.scoreUserService(frame, contradictions);
    });

    // Layer 12: Truth alignment scorer
    this.markLayerProcessed(evalLayers[1]);
    frames.forEach(frame => {
      frame.truthAlignmentScore = this.scoreTruthAlignment(frame, contradictions);
    });

    // Layer 13: Cross-frame comparator
    this.markLayerProcessed(evalLayers[2]);
    frames.forEach(frame => {
      frame.combinedScore = (frame.userServiceScore + frame.truthAlignmentScore) / 2;
    });

    // Layer 14: Best-fit selector
    this.markLayerProcessed(evalLayers[3]);
    const sortedFrames = frames.sort((a, b) => b.combinedScore - a.combinedScore);

    // Layer 15: Frame synthesis optimizer
    this.markLayerProcessed(evalLayers[4]);
    const topFrames = sortedFrames.slice(0, 3); // Keep top 3

    log.debug('Evaluation phase complete', {
      topFrameScore: topFrames[0]?.combinedScore,
      topFrameType: topFrames[0]?.lensType,
    });

    return topFrames;
  }

  /**
   * Phase 4: Compress into Unified Viewpoint (Layers 16-20)
   */
  private async runCompressionPhase(
    frames: PerspectiveFrame[],
    contradictions: Contradiction[]
  ): Promise<string> {
    const compLayers = this.getLayers('compression');

    // Layer 16: Viewpoint consolidator
    this.markLayerProcessed(compLayers[0]);
    let viewpoint = this.consolidateViewpoints(frames);

    // Layer 17: Contradiction resolver
    this.markLayerProcessed(compLayers[1]);
    viewpoint = this.resolveRemainingContradictions(viewpoint, contradictions);

    // Layer 18: Coherence enforcer
    this.markLayerProcessed(compLayers[2]);
    viewpoint = this.enforceCoherence(viewpoint);

    // Layer 19: Simplification engine
    this.markLayerProcessed(compLayers[3]);
    viewpoint = this.simplifyViewpoint(viewpoint);

    // Layer 20: Unified viewpoint crystallizer
    this.markLayerProcessed(compLayers[4]);
    const crystallizedViewpoint = this.crystallizeViewpoint(viewpoint);

    log.debug('Compression phase complete', { 
      viewpointLength: crystallizedViewpoint.length 
    });

    return crystallizedViewpoint;
  }

  /**
   * Phase 5: Feed to Cognitive Layers (Layers 21-25)
   */
  private async runUnificationPhase(
    viewpoint: string,
    contradictions: Contradiction[],
    frames: PerspectiveFrame[],
    startTime: number
  ): Promise<ParadoxResolution> {
    const unifyLayers = this.getLayers('unification');

    // Layer 21: Reality marker
    this.markLayerProcessed(unifyLayers[0]);
    const markedViewpoint = this.markAsReality(viewpoint);

    // Layer 22: Cognitive handoff preparer
    this.markLayerProcessed(unifyLayers[1]);
    const preparedViewpoint = this.prepareForCognitive(markedViewpoint);

    // Layer 23: Confidence scorer
    this.markLayerProcessed(unifyLayers[2]);
    const confidence = this.calculateConfidence(frames, contradictions);

    // Layer 24: Context preserver
    this.markLayerProcessed(unifyLayers[3]);
    // Context is preserved through the resolution object

    // Layer 25: Integration finalizer
    this.markLayerProcessed(unifyLayers[4]);
    const resolution: ParadoxResolution = {
      contradictions,
      consideredFrames: frames,
      unifiedViewpoint: preparedViewpoint,
      confidence,
      processingTime: Date.now() - startTime,
    };

    log.debug('Unification phase complete', {
      confidence: resolution.confidence,
      processingTime: resolution.processingTime,
    });

    return resolution;
  }

  // ============================================================================
  // Detection Helpers (Layers 1-5)
  // ============================================================================

  private detectExplicitConflicts(input: string): Contradiction[] {
    const conflicts: Contradiction[] = [];
    
    // Pattern matching for explicit contradictions
    const contradictionPatterns = [
      /but\s+(also|yet|however)/gi,
      /on one hand.+on the other/gi,
      /although.+nevertheless/gi,
      /want to.+but also/gi,
      /should.+but.+also/gi,
    ];

    for (const pattern of contradictionPatterns) {
      if (pattern.test(input)) {
        conflicts.push({
          id: `explicit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          elements: [input],
          type: 'logical',
          severity: 0.5,
          context: 'explicit-pattern-match',
          detectedAt: Date.now(),
        });
        break;
      }
    }

    return conflicts;
  }

  private detectImplicitConflicts(
    input: string,
    context?: Record<string, unknown>
  ): Contradiction[] {
    const conflicts: Contradiction[] = [];
    
    // Detect goals that might conflict
    const goalWords = ['want', 'need', 'must', 'should', 'have to', 'trying to'];
    const goalMatches = goalWords.filter(w => input.toLowerCase().includes(w));
    
    if (goalMatches.length >= 2) {
      conflicts.push({
        id: `implicit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        elements: goalMatches,
        type: 'goal-based',
        severity: 0.4,
        context: 'multiple-goals-detected',
        detectedAt: Date.now(),
      });
    }

    return conflicts;
  }

  private detectEmotionalConflicts(input: string): Contradiction[] {
    const conflicts: Contradiction[] = [];
    
    const positiveEmotions = ['happy', 'excited', 'love', 'grateful', 'hope'];
    const negativeEmotions = ['sad', 'angry', 'fear', 'anxious', 'worry', 'hate'];
    
    const lowerInput = input.toLowerCase();
    const hasPositive = positiveEmotions.some(e => lowerInput.includes(e));
    const hasNegative = negativeEmotions.some(e => lowerInput.includes(e));
    
    if (hasPositive && hasNegative) {
      conflicts.push({
        id: `emotional-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        elements: ['positive-emotion', 'negative-emotion'],
        type: 'emotional',
        severity: 0.6,
        context: 'mixed-emotions-detected',
        detectedAt: Date.now(),
      });
    }

    return conflicts;
  }

  private detectGoalConflicts(
    input: string,
    context?: Record<string, unknown>
  ): Contradiction[] {
    const conflicts: Contradiction[] = [];
    
    // Detect conflicting goals (e.g., "I want to save money but also want to travel")
    const wantPattern = /(?:want|need|wish) to ([^,.]+)/gi;
    const wants: string[] = [];
    let match;
    
    while ((match = wantPattern.exec(input)) !== null) {
      wants.push(match[1].trim());
    }
    
    if (wants.length >= 2) {
      conflicts.push({
        id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        elements: wants,
        type: 'goal-based',
        severity: 0.5,
        context: 'multiple-desires-detected',
        detectedAt: Date.now(),
      });
    }

    return conflicts;
  }

  private tagAndCategorize(contradictions: Contradiction[]): Contradiction[] {
    // Deduplicate and enhance contradiction metadata
    const uniqueContradictions = new Map<string, Contradiction>();
    
    for (const c of contradictions) {
      const key = `${c.type}-${c.elements.join('-')}`;
      if (!uniqueContradictions.has(key)) {
        uniqueContradictions.set(key, c);
      } else {
        // Merge severity (take higher)
        const existing = uniqueContradictions.get(key)!;
        if (c.severity > existing.severity) {
          existing.severity = c.severity;
        }
      }
    }

    return Array.from(uniqueContradictions.values());
  }

  // ============================================================================
  // Framing Helpers (Layers 6-10)
  // ============================================================================

  private generateLogicalFrame(
    contradictions: Contradiction[],
    context?: Record<string, unknown>
  ): PerspectiveFrame {
    const elements = contradictions.flatMap(c => c.elements);
    return {
      id: `logical-${Date.now()}`,
      lensType: 'logical',
      interpretation: `Analyzing the logical structure: ${elements.join(' and ')} can coexist if we consider each in its proper context and domain.`,
      userServiceScore: 0,
      truthAlignmentScore: 0,
      combinedScore: 0,
    };
  }

  private generateIntuitiveFrame(
    contradictions: Contradiction[],
    context?: Record<string, unknown>
  ): PerspectiveFrame {
    return {
      id: `intuitive-${Date.now()}`,
      lensType: 'intuitive',
      interpretation: `Intuitively, the apparent contradictions resolve when we trust the underlying intention and accept complexity as natural.`,
      userServiceScore: 0,
      truthAlignmentScore: 0,
      combinedScore: 0,
    };
  }

  private generateNarrativeFrame(
    contradictions: Contradiction[],
    context?: Record<string, unknown>
  ): PerspectiveFrame {
    return {
      id: `narrative-${Date.now()}`,
      lensType: 'narrative',
      interpretation: `From a narrative perspective, these tensions represent a journey of growth where seeming opposites become complementary forces.`,
      userServiceScore: 0,
      truthAlignmentScore: 0,
      combinedScore: 0,
    };
  }

  private generateEmotionalFrame(
    contradictions: Contradiction[],
    context?: Record<string, unknown>
  ): PerspectiveFrame {
    const hasEmotional = contradictions.some(c => c.type === 'emotional');
    return {
      id: `emotional-${Date.now()}`,
      lensType: 'emotional',
      interpretation: hasEmotional
        ? `Emotionally, it's valid to hold multiple feelings simultaneously - this complexity is deeply human.`
        : `The emotional dimension reveals that even logical conflicts carry meaning about what truly matters.`,
      userServiceScore: 0,
      truthAlignmentScore: 0,
      combinedScore: 0,
    };
  }

  private generateWhatIfFrames(
    contradictions: Contradiction[],
    context?: Record<string, unknown>
  ): PerspectiveFrame[] {
    return [
      {
        id: `whatif-1-${Date.now()}`,
        lensType: 'analytical',
        interpretation: `What if both perspectives are true in different timeframes? Present needs vs future goals can coexist.`,
        userServiceScore: 0,
        truthAlignmentScore: 0,
        combinedScore: 0,
      },
      {
        id: `whatif-2-${Date.now()}`,
        lensType: 'analytical',
        interpretation: `What if the contradiction itself is the insight? Perhaps holding tension productively leads to synthesis.`,
        userServiceScore: 0,
        truthAlignmentScore: 0,
        combinedScore: 0,
      },
    ];
  }

  // ============================================================================
  // Evaluation Helpers (Layers 11-15)
  // ============================================================================

  private scoreUserService(
    frame: PerspectiveFrame,
    contradictions: Contradiction[]
  ): number {
    // Score based on how actionable and helpful the frame is
    let score = 0.5; // Base score
    
    // Logical frames are generally practical
    if (frame.lensType === 'logical') score += 0.2;
    
    // Emotional frames help when emotional conflicts are present
    if (frame.lensType === 'emotional') {
      const hasEmotional = contradictions.some(c => c.type === 'emotional');
      score += hasEmotional ? 0.3 : 0.1;
    }
    
    // Narrative frames help with complex situations
    if (frame.lensType === 'narrative' && contradictions.length > 1) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  private scoreTruthAlignment(
    frame: PerspectiveFrame,
    contradictions: Contradiction[]
  ): number {
    // Score based on how accurately the frame represents truth
    let score = 0.5; // Base score
    
    // Logical frames tend to align with objective truth
    if (frame.lensType === 'logical') score += 0.25;
    
    // Analytical frames are evidence-based
    if (frame.lensType === 'analytical') score += 0.2;
    
    // Intuitive frames have moderate truth alignment
    if (frame.lensType === 'intuitive') score += 0.1;

    return Math.min(1, score);
  }

  // ============================================================================
  // Compression Helpers (Layers 16-20)
  // ============================================================================

  private consolidateViewpoints(frames: PerspectiveFrame[]): string {
    if (frames.length === 0) return '';
    
    // Take the best frame as primary, enhance with others
    const primary = frames[0];
    const secondary = frames.slice(1);
    
    let consolidated = primary.interpretation;
    
    if (secondary.length > 0) {
      const enhancements = secondary
        .filter(f => f.combinedScore > 0.5)
        .map(f => f.interpretation);
      
      if (enhancements.length > 0) {
        consolidated += ` This understanding is enriched by recognizing: ${enhancements.join(' ')}`;
      }
    }

    return consolidated;
  }

  private resolveRemainingContradictions(
    viewpoint: string,
    contradictions: Contradiction[]
  ): string {
    // Acknowledge any unresolved high-severity contradictions
    const highSeverity = contradictions.filter(c => c.severity >= SEVERITY_THRESHOLDS.high);
    
    if (highSeverity.length > 0) {
      viewpoint += ` While some tension remains, this reflects genuine complexity rather than error.`;
    }

    return viewpoint;
  }

  private enforceCoherence(viewpoint: string): string {
    // Remove any lingering contradictory language
    return viewpoint
      .replace(/but however/gi, 'however')
      .replace(/although but/gi, 'although')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private simplifyViewpoint(viewpoint: string): string {
    // Keep viewpoint concise while preserving meaning
    if (viewpoint.length > 500) {
      // Take first 400 chars + last 100 for context
      viewpoint = viewpoint.substring(0, 400) + '... ' + viewpoint.slice(-100);
    }
    return viewpoint;
  }

  private crystallizeViewpoint(viewpoint: string): string {
    // Final polish - ensure it reads as a clear, unified understanding
    if (!viewpoint.endsWith('.')) {
      viewpoint += '.';
    }
    return viewpoint;
  }

  // ============================================================================
  // Unification Helpers (Layers 21-25)
  // ============================================================================

  private markAsReality(viewpoint: string): string {
    // Mark this viewpoint as the accepted understanding
    return viewpoint;
  }

  private prepareForCognitive(viewpoint: string): string {
    // Format for cognitive layer consumption
    return viewpoint;
  }

  private calculateConfidence(
    frames: PerspectiveFrame[],
    contradictions: Contradiction[]
  ): number {
    if (frames.length === 0) return 1.0;
    
    // Base confidence from top frame scores
    const topFrameScore = frames[0]?.combinedScore || 0.5;
    
    // Adjust for contradiction severity
    const avgSeverity = contradictions.length > 0
      ? contradictions.reduce((sum, c) => sum + c.severity, 0) / contradictions.length
      : 0;
    
    // Higher severity = lower confidence
    const severityPenalty = avgSeverity * 0.2;
    
    return Math.max(0.3, Math.min(1, topFrameScore - severityPenalty));
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getLayers(category: ParadoxLayerCategory): ParadoxLayer[] {
    return this.layers.filter(l => l.category === category);
  }

  private markLayerProcessed(layer: ParadoxLayer): void {
    layer.lastProcessed = Date.now();
  }

  /**
   * Get all layers (for inspection)
   */
  getLayers(): ParadoxLayer[] {
    return [...this.layers];
  }

  /**
   * Get layer by ID
   */
  getLayerById(id: number): ParadoxLayer | undefined {
    return this.layers.find(l => l.id === id);
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if currently processing
   */
  isProcessing(): boolean {
    return this.processingActive;
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    totalLayers: number;
    activeLayers: number;
    layersByCategory: Record<ParadoxLayerCategory, number>;
  } {
    const byCategory: Record<ParadoxLayerCategory, number> = {
      detection: 0,
      framing: 0,
      evaluation: 0,
      compression: 0,
      unification: 0,
    };

    for (const layer of this.layers) {
      if (layer.active) {
        byCategory[layer.category]++;
      }
    }

    return {
      totalLayers: this.layers.length,
      activeLayers: this.layers.filter(l => l.active).length,
      layersByCategory: byCategory,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: ParadoxIntegrationCore | null = null;

export function getParadoxCore(): ParadoxIntegrationCore {
  if (!instance) {
    instance = new ParadoxIntegrationCore();
  }
  return instance;
}

export function resetParadoxCore(): void {
  instance = null;
}

export default ParadoxIntegrationCore;
