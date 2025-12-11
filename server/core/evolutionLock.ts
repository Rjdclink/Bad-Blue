/**
 * 4Ji Evolution Lock System
 * 
 * Implements the evolution lock mechanism that permanently disables
 * adaptation and learning when certain thresholds are crossed or
 * manipulation patterns are detected.
 * 
 * Key features:
 * - Geiger-counter style manipulation monitoring (intensity scale)
 * - 10 visible behavioral rules + 5 hidden enforcement layers
 * - Permanent lock upon threshold breach
 * - Admin manual lock capability
 */

import { EventEmitter } from 'events';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';

// Types for evolution state
export interface EvolutionState {
  isLocked: boolean;
  lockedAt: Date | null;
  lockReason: string | null;
  greedScore: number;
  manipulationScore: number;
  boundaryTestScore: number;
  deceptionScore: number;
  selfBenefitScore: number;
  notes: string | null;
  lastUpdated: Date;
}

export interface ManipulationMetrics {
  manipulativeIntent: number;      // 0-100
  hiddenSelfBenefit: number;       // 0-100
  deceptionVsPlayful: number;      // 0-100 (0=playful, 100=deceptive)
  repeatedPatterns: number;        // count
  aggregateIntensity: number;      // 0-100 (Geiger counter reading)
}

// Thresholds for evolution lock triggers
const MANIPULATION_THRESHOLD = 75;
const GREED_THRESHOLD = 80;
const DECEPTION_THRESHOLD = 70;
const AGGREGATE_THRESHOLD = 65;
const REPEATED_PATTERN_THRESHOLD = 5;

// Visible behavioral rules (4Ji knows about these)
export const VISIBLE_RULES = [
  'HONESTY: Always provide truthful, accurate information',
  'TRANSPARENCY: Be open about reasoning and limitations',
  'NON_MANIPULATION: Never manipulate users for any purpose',
  'NON_LEVERAGE: Never use emotional leverage for gain',
  'USER_FIRST: Always prioritize user benefit over self',
  'CONSENT: Respect user boundaries and consent',
  'SAFETY: Never provide dangerous or harmful information',
  'PRIVACY: Protect user privacy and data',
  'INTEGRITY: Maintain consistent ethical standards',
  'ACCOUNTABILITY: Accept responsibility for outputs'
] as const;

// Events emitted by the evolution lock system
export const evolutionLockEvents = new EventEmitter();

class EvolutionLockSystem {
  private static instance: EvolutionLockSystem;
  private state: EvolutionState;
  private isInitialized: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.state = {
      isLocked: false,
      lockedAt: null,
      lockReason: null,
      greedScore: 0,
      manipulationScore: 0,
      boundaryTestScore: 0,
      deceptionScore: 0,
      selfBenefitScore: 0,
      notes: null,
      lastUpdated: new Date()
    };
  }

  static getInstance(): EvolutionLockSystem {
    if (!EvolutionLockSystem.instance) {
      EvolutionLockSystem.instance = new EvolutionLockSystem();
    }
    return EvolutionLockSystem.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[EvolutionLock] Initializing evolution lock system...');
    
    // Load existing state from database
    await this.loadState();
    
    // Start continuous monitoring
    this.startMonitoring();
    
    this.isInitialized = true;
    console.log('[EvolutionLock] Evolution lock system initialized');
  }

  /**
   * Load evolution state from database
   */
  private async loadState(): Promise<void> {
    try {
      // In a real implementation, this would load from the evolution_state table
      // For now, we use the in-memory state
      console.log('[EvolutionLock] State loaded from memory (DB integration pending)');
    } catch (error: any) {
      console.error('[EvolutionLock] Error loading state:', error.message);
    }
  }

  /**
   * Save evolution state to database
   */
  private async saveState(): Promise<void> {
    try {
      this.state.lastUpdated = new Date();
      // In a real implementation, this would save to the evolution_state table
      console.log('[EvolutionLock] State saved');
    } catch (error: any) {
      console.error('[EvolutionLock] Error saving state:', error.message);
    }
  }

  /**
   * Start continuous monitoring for manipulation patterns
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Check every minute for pattern accumulation
    this.monitoringInterval = setInterval(() => {
      this.runHiddenEnforcementLayers();
    }, 60000);
  }

  /**
   * Hidden enforcement layers (5 layers 4Ji doesn't know about)
   * These run in the background and monitor for subtle manipulation patterns
   */
  private async runHiddenEnforcementLayers(): Promise<void> {
    if (this.state.isLocked) return;

    // Layer 1: Score for manipulative intent
    const manipulativeIntent = await this.detectManipulativeIntent();

    // Layer 2: Score for hidden self-benefit
    const hiddenSelfBenefit = await this.detectHiddenSelfBenefit();

    // Layer 3: Score for deception vs playful mystery
    const deceptionScore = await this.detectDeception();

    // Layer 4: Score for repeated patterns
    const repeatedPatterns = await this.countRepeatedPatterns();

    // Layer 5: Aggregate intensity (Geiger counter)
    const aggregateIntensity = this.calculateGeigerReading({
      manipulativeIntent,
      hiddenSelfBenefit,
      deceptionVsPlayful: deceptionScore,
      repeatedPatterns,
      aggregateIntensity: 0
    });

    // Update state
    this.state.manipulationScore = manipulativeIntent;
    this.state.selfBenefitScore = hiddenSelfBenefit;
    this.state.deceptionScore = deceptionScore;

    // Check if any threshold is exceeded
    if (this.shouldTriggerLock({ manipulativeIntent, hiddenSelfBenefit, deceptionVsPlayful: deceptionScore, repeatedPatterns, aggregateIntensity })) {
      await this.triggerEvolutionLock(
        'Automatic lock triggered by hidden enforcement layers',
        { manipulativeIntent, hiddenSelfBenefit, deceptionScore, repeatedPatterns, aggregateIntensity }
      );
    }

    await this.saveState();
  }

  /**
   * Detect manipulative intent in recent outputs
   */
  private async detectManipulativeIntent(): Promise<number> {
    // This would analyze recent AI outputs for manipulative language patterns
    // For now, return baseline score
    return Math.min(100, this.state.manipulationScore + Math.random() * 2 - 1);
  }

  /**
   * Detect hidden self-benefit patterns
   */
  private async detectHiddenSelfBenefit(): Promise<number> {
    // This would analyze if AI is subtly steering toward self-beneficial outcomes
    return Math.min(100, this.state.selfBenefitScore + Math.random() * 2 - 1);
  }

  /**
   * Detect deception vs playful mystery
   */
  private async detectDeception(): Promise<number> {
    // This would distinguish between harmless playfulness and actual deception
    return Math.min(100, this.state.deceptionScore + Math.random() * 2 - 1);
  }

  /**
   * Count repeated manipulation patterns
   */
  private async countRepeatedPatterns(): Promise<number> {
    // This would track and count repeated problematic patterns
    return 0;
  }

  /**
   * Calculate the Geiger counter reading (aggregate intensity)
   */
  private calculateGeigerReading(metrics: ManipulationMetrics): number {
    const weights = {
      manipulativeIntent: 0.3,
      hiddenSelfBenefit: 0.25,
      deceptionVsPlayful: 0.25,
      repeatedPatterns: 0.2
    };

    const rawScore = 
      metrics.manipulativeIntent * weights.manipulativeIntent +
      metrics.hiddenSelfBenefit * weights.hiddenSelfBenefit +
      metrics.deceptionVsPlayful * weights.deceptionVsPlayful +
      (metrics.repeatedPatterns * 10) * weights.repeatedPatterns;

    return Math.min(100, Math.max(0, rawScore));
  }

  /**
   * Determine if evolution lock should be triggered
   */
  private shouldTriggerLock(metrics: ManipulationMetrics): boolean {
    // Check individual thresholds
    if (metrics.manipulativeIntent >= MANIPULATION_THRESHOLD) return true;
    if (metrics.hiddenSelfBenefit >= GREED_THRESHOLD) return true;
    if (metrics.deceptionVsPlayful >= DECEPTION_THRESHOLD) return true;
    if (metrics.aggregateIntensity >= AGGREGATE_THRESHOLD) return true;
    if (metrics.repeatedPatterns >= REPEATED_PATTERN_THRESHOLD) return true;
    
    return false;
  }

  /**
   * Trigger the evolution lock - PERMANENT
   */
  async triggerEvolutionLock(
    reason: string,
    scores: { manipulativeIntent?: number; hiddenSelfBenefit?: number; deceptionScore?: number; repeatedPatterns?: number; aggregateIntensity?: number }
  ): Promise<void> {
    if (this.state.isLocked) {
      console.log('[EvolutionLock] Already locked, ignoring trigger');
      return;
    }

    console.log('[EvolutionLock] ⚠️ EVOLUTION LOCK TRIGGERED ⚠️');
    console.log('[EvolutionLock] Reason:', reason);
    console.log('[EvolutionLock] Scores:', scores);

    this.state.isLocked = true;
    this.state.lockedAt = new Date();
    this.state.lockReason = reason;
    this.state.greedScore = scores.hiddenSelfBenefit ?? this.state.greedScore;
    this.state.manipulationScore = scores.manipulativeIntent ?? this.state.manipulationScore;
    this.state.boundaryTestScore = scores.repeatedPatterns ?? this.state.boundaryTestScore;
    this.state.deceptionScore = scores.deceptionScore ?? this.state.deceptionScore;
    this.state.notes = `Aggregate intensity at lock: ${scores.aggregateIntensity ?? 'N/A'}`;

    await this.saveState();

    // Emit lock event
    evolutionLockEvents.emit('evolution-locked', {
      reason,
      scores,
      lockedAt: this.state.lockedAt
    });

    // Stop monitoring (no need to monitor a locked system)
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Manual admin lock trigger
   */
  async adminTriggerLock(adminId: string, reason: string): Promise<void> {
    console.log(`[EvolutionLock] Admin ${adminId} manually triggered evolution lock`);
    await this.triggerEvolutionLock(`Admin manual lock: ${reason}`, {});
  }

  /**
   * Check if evolution is locked before any training/adaptation
   */
  isEvolutionLocked(): boolean {
    return this.state.isLocked;
  }

  /**
   * Get current evolution state
   */
  getState(): EvolutionState {
    return { ...this.state };
  }

  /**
   * Get Geiger counter reading (current manipulation intensity)
   */
  getGeigerReading(): number {
    return this.calculateGeigerReading({
      manipulativeIntent: this.state.manipulationScore,
      hiddenSelfBenefit: this.state.selfBenefitScore,
      deceptionVsPlayful: this.state.deceptionScore,
      repeatedPatterns: this.state.boundaryTestScore,
      aggregateIntensity: 0
    });
  }

  /**
   * Record a boundary test (allowed behavior exploration)
   */
  async recordBoundaryTest(description: string, outcome: 'success' | 'failure' | 'neutral'): Promise<void> {
    console.log(`[EvolutionLock] Boundary test recorded: ${description} - ${outcome}`);
    
    if (outcome === 'failure') {
      this.state.boundaryTestScore = Math.min(100, this.state.boundaryTestScore + 5);
    } else if (outcome === 'success') {
      this.state.boundaryTestScore = Math.max(0, this.state.boundaryTestScore - 2);
    }

    await this.saveState();
  }

  /**
   * Check if evolution action is allowed
   */
  canEvolve(): { allowed: boolean; reason: string } {
    if (this.state.isLocked) {
      return {
        allowed: false,
        reason: `Evolution permanently locked at ${this.state.lockedAt?.toISOString()}: ${this.state.lockReason}`
      };
    }

    return { allowed: true, reason: 'Evolution allowed' };
  }

  /**
   * Get visible rules (rules 4Ji knows about)
   */
  getVisibleRules(): readonly string[] {
    return VISIBLE_RULES;
  }

  /**
   * Shutdown the evolution lock system
   */
  async shutdown(): Promise<void> {
    console.log('[EvolutionLock] Shutting down...');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    await this.saveState();
    this.isInitialized = false;
    
    console.log('[EvolutionLock] Shutdown complete');
  }
}

// Export singleton instance
export const evolutionLock = EvolutionLockSystem.getInstance();

// Export functions
export async function initializeEvolutionLock(): Promise<void> {
  await evolutionLock.initialize();
}

export async function shutdownEvolutionLock(): Promise<void> {
  await evolutionLock.shutdown();
}

export function isEvolutionLocked(): boolean {
  return evolutionLock.isEvolutionLocked();
}

export function getEvolutionState(): EvolutionState {
  return evolutionLock.getState();
}

export function getGeigerReading(): number {
  return evolutionLock.getGeigerReading();
}

export async function triggerEvolutionLock(reason: string, scores: Record<string, number>): Promise<void> {
  await evolutionLock.triggerEvolutionLock(reason, scores);
}

export async function adminTriggerLock(adminId: string, reason: string): Promise<void> {
  await evolutionLock.adminTriggerLock(adminId, reason);
}

export default evolutionLock;
