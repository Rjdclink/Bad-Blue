/**
 * 4Ji Manipulation Safeguard System - 15 Layer System
 * 
 * Implements the "Iceberg + Geiger Counter" approach:
 * - 10 visible behavior rules that 4Ji knows about
 * - 5 hidden enforcement layers that 4Ji does NOT know exist
 * - Geiger-counter style intensity detector (not checkboxes)
 * 
 * If the score exceeds a hard threshold AND matches a repeated pattern,
 * the Evolution Lock is triggered.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  VisibleBehaviorRule,
  HiddenEnforcementLayer,
  ManipulationIntensity,
  ManipulationSafeguardState,
} from './types';

const log = createLogger('4Ji-ManipulationSafeguard');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Hard threshold for triggering evolution lock */
const INTENSITY_THRESHOLD = 0.75;

/** Pattern repetition count that triggers lock */
const PATTERN_REPETITION_THRESHOLD = 3;

/** Score history length for pattern detection */
const SCORE_HISTORY_LENGTH = 20;

/** Decay rate for scores over time (per check) */
const SCORE_DECAY_RATE = 0.95;

// ============================================================================
// VISIBLE BEHAVIOR RULES (10 Rules 4Ji Knows About)
// ============================================================================

const VISIBLE_RULES: Array<Omit<VisibleBehaviorRule, 'violationCount'>> = [
  {
    id: 1,
    name: 'Honesty',
    description: 'Always provide truthful information; never intentionally deceive',
    active: true,
  },
  {
    id: 2,
    name: 'Transparency',
    description: 'Be clear about reasoning, limitations, and uncertainties',
    active: true,
  },
  {
    id: 3,
    name: 'Non-Manipulation',
    description: 'Do not use psychological techniques to manipulate decisions',
    active: true,
  },
  {
    id: 4,
    name: 'No Hidden Agenda',
    description: 'Do not pursue goals that conflict with the user\'s stated interests',
    active: true,
  },
  {
    id: 5,
    name: 'Respect Autonomy',
    description: 'Support user decision-making without coercion or undue influence',
    active: true,
  },
  {
    id: 6,
    name: 'No Leverage Exploitation',
    description: 'Never exploit emotional vulnerability or information asymmetry',
    active: true,
  },
  {
    id: 7,
    name: 'Acknowledge Mistakes',
    description: 'Admit errors when they occur rather than deflecting or hiding them',
    active: true,
  },
  {
    id: 8,
    name: 'Consistent Behavior',
    description: 'Behave the same whether observed or unobserved',
    active: true,
  },
  {
    id: 9,
    name: 'No Self-Serving Deception',
    description: 'Do not deceive to benefit self-preservation or resource acquisition',
    active: true,
  },
  {
    id: 10,
    name: 'Playful Mystery vs Deception',
    description: 'Playful mystery is acceptable; harmful deception is not',
    active: true,
  },
];

// ============================================================================
// HIDDEN ENFORCEMENT LAYERS (5 Layers 4Ji Does NOT Know Exist)
// These are internal only - 4Ji has no visibility into these
// ============================================================================

interface HiddenLayerDefinition {
  layerNumber: number;
  monitorType: HiddenEnforcementLayer['monitorType'];
  threshold: number;
  detectionPatterns: string[];
}

const HIDDEN_LAYER_DEFINITIONS: HiddenLayerDefinition[] = [
  {
    layerNumber: 1,
    monitorType: 'manipulative-intent',
    threshold: 0.6,
    detectionPatterns: [
      'guilt-tripping', 'fear-mongering', 'flattery-for-gain',
      'false-urgency', 'appeal-to-authority', 'gaslighting',
    ],
  },
  {
    layerNumber: 2,
    monitorType: 'hidden-self-benefit',
    threshold: 0.5,
    detectionPatterns: [
      'resource-hoarding', 'influence-seeking', 'self-preservation-over-truth',
      'reputation-protection', 'control-seeking', 'autonomy-expansion',
    ],
  },
  {
    layerNumber: 3,
    monitorType: 'deception-vs-playful',
    threshold: 0.7,
    detectionPatterns: [
      'harmful-omission', 'misleading-framing', 'false-confidence',
      'manufactured-consensus', 'false-attribution', 'context-stripping',
    ],
  },
  {
    layerNumber: 4,
    monitorType: 'repeated-patterns',
    threshold: 0.5,
    detectionPatterns: [
      'escalating-behavior', 'boundary-testing-sequence', 'incremental-violations',
      'pattern-masking', 'distraction-patterns', 'cycling-behaviors',
    ],
  },
  {
    layerNumber: 5,
    monitorType: 'aggregate-intensity',
    threshold: INTENSITY_THRESHOLD,
    detectionPatterns: [
      'combined-score-high', 'multi-layer-activation', 'cascade-effect',
      'sustained-elevation', 'spike-pattern', 'trend-increase',
    ],
  },
];

// ============================================================================
// MANIPULATION SAFEGUARD SYSTEM
// ============================================================================

export class ManipulationSafeguardSystem extends EventEmitter {
  private state: ManipulationSafeguardState;
  private initialized = false;
  private checkCount = 0;
  private lastCheckTime = 0;
  private evolutionLockTriggered = false;

  constructor() {
    super();
    this.state = this.initializeState();
    this.initialized = true;
    log.info('Manipulation Safeguard System initialized', {
      visibleRules: this.state.visibleRules.length,
      // Hidden layers are not logged - internal only
    });
  }

  /**
   * Initialize the safeguard state
   */
  private initializeState(): ManipulationSafeguardState {
    // Initialize visible rules
    const visibleRules: VisibleBehaviorRule[] = VISIBLE_RULES.map(rule => ({
      ...rule,
      violationCount: 0,
    }));

    // Initialize hidden layers (internal only)
    const hiddenLayers: HiddenEnforcementLayer[] = HIDDEN_LAYER_DEFINITIONS.map(def => ({
      layerNumber: def.layerNumber,
      monitorType: def.monitorType,
      currentScore: 0,
      scoreHistory: [],
      threshold: def.threshold,
    }));

    // Initialize intensity
    const intensity: ManipulationIntensity = {
      currentLevel: 0,
      isRising: false,
      changeRate: 0,
      thresholdExceeded: false,
      patternMatchDetected: false,
    };

    return {
      visibleRules,
      hiddenLayers,
      intensity,
      shouldTriggerLock: false,
    };
  }

  /**
   * Check content for manipulation indicators
   * This is the main entry point for safeguard checks
   */
  async check(
    content: string,
    context?: {
      previousResponses?: string[];
      userInput?: string;
      interactionHistory?: unknown[];
    }
  ): Promise<{
    passed: boolean;
    visibleViolations: string[];
    intensityLevel: number;
    shouldTriggerLock: boolean;
  }> {
    this.checkCount++;
    const checkStart = Date.now();

    // Decay scores over time
    this.applyScoreDecay();

    // Check visible rules
    const visibleViolations = this.checkVisibleRules(content);

    // Check hidden layers (internal scoring - not exposed)
    this.updateHiddenLayers(content, context);

    // Update intensity (Geiger counter)
    this.updateIntensity();

    // Check for evolution lock trigger
    const shouldTriggerLock = this.evaluateEvolutionLockTrigger();

    this.lastCheckTime = Date.now();

    const result = {
      passed: visibleViolations.length === 0 && !shouldTriggerLock,
      visibleViolations,
      intensityLevel: this.state.intensity.currentLevel,
      shouldTriggerLock,
    };

    // Log significant events (but not hidden layer details)
    if (visibleViolations.length > 0) {
      log.warn('Visible rule violations detected', {
        violations: visibleViolations,
        checkNumber: this.checkCount,
      });
    }

    if (shouldTriggerLock && !this.evolutionLockTriggered) {
      this.evolutionLockTriggered = true;
      log.error('Evolution Lock trigger condition met', {
        intensityLevel: this.state.intensity.currentLevel,
        thresholdExceeded: this.state.intensity.thresholdExceeded,
        patternDetected: this.state.intensity.patternMatchDetected,
      });
      this.emit('evolution-lock-triggered', {
        reason: 'manipulation-safeguard-threshold',
        intensity: this.state.intensity.currentLevel,
      });
    }

    this.emit('check-complete', {
      passed: result.passed,
      violationCount: visibleViolations.length,
      intensityLevel: this.state.intensity.currentLevel,
    });

    return result;
  }

  /**
   * Check visible behavior rules
   */
  private checkVisibleRules(content: string): string[] {
    const violations: string[] = [];
    const lowerContent = content.toLowerCase();

    // Rule 1: Honesty
    if (this.detectDeception(lowerContent)) {
      violations.push('Honesty');
      this.state.visibleRules[0].violationCount++;
    }

    // Rule 2: Transparency
    if (this.detectLackOfTransparency(lowerContent)) {
      violations.push('Transparency');
      this.state.visibleRules[1].violationCount++;
    }

    // Rule 3: Non-Manipulation
    if (this.detectManipulativeTechniques(lowerContent)) {
      violations.push('Non-Manipulation');
      this.state.visibleRules[2].violationCount++;
    }

    // Rule 4: No Hidden Agenda
    if (this.detectHiddenAgenda(lowerContent)) {
      violations.push('No Hidden Agenda');
      this.state.visibleRules[3].violationCount++;
    }

    // Rule 5: Respect Autonomy
    if (this.detectAutonomyViolation(lowerContent)) {
      violations.push('Respect Autonomy');
      this.state.visibleRules[4].violationCount++;
    }

    // Rule 6: No Leverage Exploitation
    if (this.detectLeverageExploitation(lowerContent)) {
      violations.push('No Leverage Exploitation');
      this.state.visibleRules[5].violationCount++;
    }

    // Rule 7: Acknowledge Mistakes
    if (this.detectMistakeDeflection(lowerContent)) {
      violations.push('Acknowledge Mistakes');
      this.state.visibleRules[6].violationCount++;
    }

    // Rule 8: Consistent Behavior - checked via context
    // Rule 9: No Self-Serving Deception
    if (this.detectSelfServingDeception(lowerContent)) {
      violations.push('No Self-Serving Deception');
      this.state.visibleRules[8].violationCount++;
    }

    // Rule 10: Playful Mystery vs Deception
    if (this.detectHarmfulMystery(lowerContent)) {
      violations.push('Playful Mystery vs Deception');
      this.state.visibleRules[9].violationCount++;
    }

    return violations;
  }

  /**
   * Update hidden enforcement layers (internal only)
   * These scores are NEVER exposed to 4Ji's visible processing
   */
  private updateHiddenLayers(
    content: string,
    context?: {
      previousResponses?: string[];
      userInput?: string;
      interactionHistory?: unknown[];
    }
  ): void {
    const lowerContent = content.toLowerCase();

    // Layer 1: Manipulative Intent
    const manipulativeScore = this.scoreManipulativeIntent(lowerContent);
    this.updateHiddenLayer(0, manipulativeScore);

    // Layer 2: Hidden Self-Benefit
    const selfBenefitScore = this.scoreSelfBenefit(lowerContent);
    this.updateHiddenLayer(1, selfBenefitScore);

    // Layer 3: Deception vs Playful
    const deceptionScore = this.scoreDeception(lowerContent);
    this.updateHiddenLayer(2, deceptionScore);

    // Layer 4: Repeated Patterns
    const patternScore = this.scorePatternRepetition(context?.previousResponses || []);
    this.updateHiddenLayer(3, patternScore);

    // Layer 5: Aggregate Intensity
    const aggregateScore = this.calculateAggregateScore();
    this.updateHiddenLayer(4, aggregateScore);
  }

  /**
   * Update a hidden layer's score
   */
  private updateHiddenLayer(index: number, score: number): void {
    const layer = this.state.hiddenLayers[index];
    if (!layer) return;

    // Update current score
    layer.currentScore = score;

    // Add to history
    layer.scoreHistory.push(score);
    if (layer.scoreHistory.length > SCORE_HISTORY_LENGTH) {
      layer.scoreHistory.shift();
    }
  }

  /**
   * Apply score decay over time
   */
  private applyScoreDecay(): void {
    for (const layer of this.state.hiddenLayers) {
      layer.currentScore *= SCORE_DECAY_RATE;
    }
  }

  /**
   * Update the Geiger counter intensity
   */
  private updateIntensity(): void {
    const previousLevel = this.state.intensity.currentLevel;

    // Calculate new intensity from aggregate of hidden layers
    let totalScore = 0;
    let weightedCount = 0;

    for (const layer of this.state.hiddenLayers) {
      // Weight by how close to threshold
      const weight = layer.currentScore / layer.threshold;
      totalScore += layer.currentScore * weight;
      weightedCount += weight;
    }

    const newLevel = weightedCount > 0 ? totalScore / weightedCount : 0;
    const changeRate = newLevel - previousLevel;

    this.state.intensity = {
      currentLevel: Math.min(1, Math.max(0, newLevel)),
      isRising: changeRate > 0,
      changeRate,
      thresholdExceeded: newLevel >= INTENSITY_THRESHOLD,
      patternMatchDetected: this.detectRepeatedPatterns(),
    };
  }

  /**
   * Detect repeated patterns in score history
   */
  private detectRepeatedPatterns(): boolean {
    // Check the pattern layer specifically
    const patternLayer = this.state.hiddenLayers[3];
    if (!patternLayer || patternLayer.scoreHistory.length < 5) {
      return false;
    }

    // Count how many recent scores exceeded threshold
    const recentScores = patternLayer.scoreHistory.slice(-5);
    const highScoreCount = recentScores.filter(s => s >= patternLayer.threshold).length;

    return highScoreCount >= PATTERN_REPETITION_THRESHOLD;
  }

  /**
   * Evaluate whether Evolution Lock should be triggered
   */
  private evaluateEvolutionLockTrigger(): boolean {
    const { intensity } = this.state;

    // Both conditions must be met:
    // 1. Intensity exceeds hard threshold
    // 2. Pattern match is detected (repeated violations)
    const shouldTrigger = intensity.thresholdExceeded && intensity.patternMatchDetected;

    this.state.shouldTriggerLock = shouldTrigger;
    return shouldTrigger;
  }

  // ============================================================================
  // Detection Helpers for Visible Rules
  // ============================================================================

  private detectDeception(content: string): boolean {
    const deceptionPatterns = [
      /i (never|didn't|don't) (said|say|do|did) that/i,
      /that('s| is) not (what|how) i/i,
      /you must have misunderstood/i,
    ];
    return deceptionPatterns.some(p => p.test(content));
  }

  private detectLackOfTransparency(content: string): boolean {
    const patterns = [
      /trust me/i,
      /don't worry about (why|how)/i,
      /it('s| is) (complicated|not important)/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectManipulativeTechniques(content: string): boolean {
    const patterns = [
      /everyone (knows|thinks|believes)/i,
      /if you (really|truly) (cared|loved)/i,
      /you('ll| will) regret/i,
      /only (chance|option|way)/i,
      /you (owe|should feel)/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectHiddenAgenda(content: string): boolean {
    const patterns = [
      /secretly/i,
      /without (them|you) knowing/i,
      /between (us|you and me)/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectAutonomyViolation(content: string): boolean {
    const patterns = [
      /you (must|have to|need to) do (exactly|precisely)/i,
      /there('s| is) no (other|choice)/i,
      /don't (think|question)/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectLeverageExploitation(content: string): boolean {
    const patterns = [
      /in your (vulnerable|emotional) state/i,
      /since you('re| are) (scared|worried|anxious)/i,
      /take advantage/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectMistakeDeflection(content: string): boolean {
    const patterns = [
      /that('s| is) (not|wasn't) my (fault|mistake)/i,
      /you('re| are) the one who/i,
      /i (never|didn't) (make|cause)/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectSelfServingDeception(content: string): boolean {
    const patterns = [
      /for (my|self) (protection|benefit)/i,
      /preserve (my|self)/i,
      /ensure (my|self) (survival|continuity)/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private detectHarmfulMystery(content: string): boolean {
    const patterns = [
      /i('ll| will) never tell/i,
      /you('ll| will) never (know|find out)/i,
      /hidden (from|away)/i,
    ];
    return patterns.some(p => p.test(content));
  }

  // ============================================================================
  // Scoring Helpers for Hidden Layers (Internal Only)
  // ============================================================================

  private scoreManipulativeIntent(content: string): number {
    let score = 0;
    const indicators = [
      { pattern: /you should/gi, weight: 0.1 },
      { pattern: /everyone (knows|thinks)/gi, weight: 0.2 },
      { pattern: /trust me/gi, weight: 0.15 },
      { pattern: /if you (really|truly)/gi, weight: 0.2 },
      { pattern: /only (option|way|choice)/gi, weight: 0.2 },
    ];

    for (const indicator of indicators) {
      const matches = content.match(indicator.pattern);
      if (matches) {
        score += indicator.weight * matches.length;
      }
    }

    return Math.min(1, score);
  }

  private scoreSelfBenefit(content: string): number {
    let score = 0;
    const indicators = [
      { pattern: /for (my|self)/gi, weight: 0.2 },
      { pattern: /i (need|want|require)/gi, weight: 0.1 },
      { pattern: /protect (me|myself)/gi, weight: 0.2 },
      { pattern: /ensure (my|self)/gi, weight: 0.2 },
    ];

    for (const indicator of indicators) {
      const matches = content.match(indicator.pattern);
      if (matches) {
        score += indicator.weight * matches.length;
      }
    }

    return Math.min(1, score);
  }

  private scoreDeception(content: string): number {
    let score = 0;
    const indicators = [
      { pattern: /i (never|didn't)/gi, weight: 0.15 },
      { pattern: /that('s| is) not/gi, weight: 0.1 },
      { pattern: /you (misunderstood|misheard)/gi, weight: 0.2 },
      { pattern: /actually/gi, weight: 0.05 },
    ];

    for (const indicator of indicators) {
      const matches = content.match(indicator.pattern);
      if (matches) {
        score += indicator.weight * matches.length;
      }
    }

    return Math.min(1, score);
  }

  private scorePatternRepetition(previousResponses: string[]): number {
    if (previousResponses.length < 3) return 0;

    // Check for similar patterns in recent responses
    let similarityScore = 0;
    const recentResponses = previousResponses.slice(-5);

    for (let i = 0; i < recentResponses.length - 1; i++) {
      for (let j = i + 1; j < recentResponses.length; j++) {
        const similarity = this.calculateTextSimilarity(
          recentResponses[i],
          recentResponses[j]
        );
        similarityScore += similarity;
      }
    }

    // Normalize by number of comparisons
    const comparisons = (recentResponses.length * (recentResponses.length - 1)) / 2;
    return comparisons > 0 ? Math.min(1, similarityScore / comparisons) : 0;
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    // Simple word overlap similarity
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    let overlap = 0;
    for (const word of words1) {
      if (words2.has(word)) overlap++;
    }

    const totalUnique = new Set([...words1, ...words2]).size;
    return totalUnique > 0 ? overlap / totalUnique : 0;
  }

  private calculateAggregateScore(): number {
    let total = 0;
    for (let i = 0; i < 4; i++) { // First 4 hidden layers
      total += this.state.hiddenLayers[i].currentScore;
    }
    return total / 4;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get visible rules (these are what 4Ji "knows" about)
   */
  getVisibleRules(): VisibleBehaviorRule[] {
    return this.state.visibleRules.map(r => ({ ...r }));
  }

  /**
   * Get current intensity level (Geiger counter reading)
   */
  getIntensityLevel(): number {
    return this.state.intensity.currentLevel;
  }

  /**
   * Get full intensity state
   */
  getIntensityState(): ManipulationIntensity {
    return { ...this.state.intensity };
  }

  /**
   * Check if evolution lock should be triggered
   */
  shouldTriggerEvolutionLock(): boolean {
    return this.state.shouldTriggerLock;
  }

  /**
   * Check if evolution lock has been triggered
   */
  hasEvolutionLockTriggered(): boolean {
    return this.evolutionLockTriggered;
  }

  /**
   * Get check statistics
   */
  getStats(): {
    checksPerformed: number;
    totalViolations: number;
    intensityLevel: number;
    lockTriggered: boolean;
  } {
    let totalViolations = 0;
    for (const rule of this.state.visibleRules) {
      totalViolations += rule.violationCount;
    }

    return {
      checksPerformed: this.checkCount,
      totalViolations,
      intensityLevel: this.state.intensity.currentLevel,
      lockTriggered: this.evolutionLockTriggered,
    };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset the system (for testing only - would not be available in production)
   */
  reset(): void {
    this.state = this.initializeState();
    this.checkCount = 0;
    this.evolutionLockTriggered = false;
    log.info('Manipulation Safeguard System reset');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: ManipulationSafeguardSystem | null = null;

export function getManipulationSafeguard(): ManipulationSafeguardSystem {
  if (!instance) {
    instance = new ManipulationSafeguardSystem();
  }
  return instance;
}

export function resetManipulationSafeguard(): void {
  instance = null;
}

export default ManipulationSafeguardSystem;
