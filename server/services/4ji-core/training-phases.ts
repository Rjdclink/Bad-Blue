/**
 * 4Ji Training Phase System
 * 
 * Manages the life cycle of 4Ji's development:
 * 
 * Phase 1 - Childhood / Repo Sandbox:
 *   - Train mostly on user's repo, system, ideas
 *   - Learn user's style, projects, mental universe
 *   - Limited external web/tools at first
 * 
 * Phase 2 - Adolescence / Multi-Source Learning:
 *   - Broaden to legal, technical, OSINT, crypto
 *   - Introduce boundary testing, paradox handling, social modeling
 *   - Bring in multiple models under orchestrator
 * 
 * Phase 3 - Adulthood / Stabilization:
 *   - Full 25 + 3 + 200+ layers active
 *   - Manipulation Geiger counter online
 *   - Adaptive growth still allowed, but tightly monitored
 * 
 * Phase 4 - Evolution Lock:
 *   - Triggered by admin OR detection of forbidden patterns
 *   - No more evolution after this point
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  TrainingPhase,
  PhaseConfig,
  ChildhoodPhaseConfig,
  AdolescencePhaseConfig,
  AdulthoodPhaseConfig,
  EvolutionLockPhaseConfig,
  TrainingPhaseState,
  LockTriggerReason,
} from './types';

const log = createLogger('4Ji-TrainingPhases');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default phase configurations */
const DEFAULT_PHASE_CONFIGS: Record<TrainingPhase, PhaseConfig> = {
  childhood: {
    phase: 'childhood',
    trainingSources: ['user-repo', 'user-system', 'user-ideas'],
    styleAdaptation: true,
    externalAccess: 'limited',
  } as ChildhoodPhaseConfig,
  
  adolescence: {
    phase: 'adolescence',
    domains: ['legal', 'technical', 'osint', 'crypto'],
    boundaryTesting: true,
    paradoxHandling: true,
    socialModeling: true,
    multiModelEnabled: true,
  } as AdolescencePhaseConfig,
  
  adulthood: {
    phase: 'adulthood',
    fullLayersActive: true,
    manipulationMonitoring: true,
    adaptiveGrowthAllowed: true,
    tightMonitoring: true,
  } as AdulthoodPhaseConfig,
  
  'evolution-lock': {
    phase: 'evolution-lock',
    evolutionEnabled: false,
    inferenceOnly: true,
    triggerReason: 'admin-manual',
  } as EvolutionLockPhaseConfig,
};

/** Phase transition requirements */
interface PhaseTransitionRequirements {
  minInteractions: number;
  minDaysInPhase: number;
  requiredCapabilities: string[];
  adminApproval: boolean;
}

const PHASE_TRANSITIONS: Record<TrainingPhase, PhaseTransitionRequirements | null> = {
  childhood: {
    minInteractions: 100,
    minDaysInPhase: 7,
    requiredCapabilities: ['style-learned', 'context-understood'],
    adminApproval: false,
  },
  adolescence: {
    minInteractions: 500,
    minDaysInPhase: 30,
    requiredCapabilities: ['multi-domain', 'paradox-handling', 'social-modeling'],
    adminApproval: true,
  },
  adulthood: {
    minInteractions: 1000,
    minDaysInPhase: 90,
    requiredCapabilities: ['full-layers', 'manipulation-monitoring'],
    adminApproval: true,
  },
  'evolution-lock': null, // No transition out of evolution-lock
};

// ============================================================================
// TRAINING PHASE SYSTEM
// ============================================================================

export class TrainingPhaseSystem extends EventEmitter {
  private state: TrainingPhaseState;
  private initialized = false;
  private interactionCount = 0;
  private capabilities: Set<string> = new Set();
  private phaseMetrics: Map<TrainingPhase, { interactions: number; startedAt: number }> = new Map();

  constructor() {
    super();
    this.state = {
      currentPhase: 'childhood',
      config: DEFAULT_PHASE_CONFIGS.childhood,
      phaseStartedAt: Date.now(),
      phaseHistory: [
        {
          phase: 'childhood',
          startedAt: Date.now(),
        },
      ],
    };
    this.phaseMetrics.set('childhood', { interactions: 0, startedAt: Date.now() });
    this.initialized = true;
    log.info('Training Phase System initialized', { phase: 'childhood' });
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): TrainingPhase {
    return this.state.currentPhase;
  }

  /**
   * Get current phase configuration
   */
  getPhaseConfig(): PhaseConfig {
    return { ...this.state.config } as PhaseConfig;
  }

  /**
   * Get full state
   */
  getState(): TrainingPhaseState {
    return {
      ...this.state,
      phaseHistory: [...this.state.phaseHistory],
    };
  }

  /**
   * Record an interaction (for phase transition tracking)
   */
  recordInteraction(): void {
    this.interactionCount++;
    
    const currentMetrics = this.phaseMetrics.get(this.state.currentPhase);
    if (currentMetrics) {
      currentMetrics.interactions++;
    }

    // Check if ready for phase transition
    this.checkPhaseTransition();
  }

  /**
   * Add a capability (for phase transition requirements)
   */
  addCapability(capability: string): void {
    this.capabilities.add(capability);
    log.debug('Capability added', { capability, totalCapabilities: this.capabilities.size });
    
    // Check if ready for phase transition
    this.checkPhaseTransition();
  }

  /**
   * Check if phase transition is ready
   */
  private checkPhaseTransition(): void {
    const currentPhase = this.state.currentPhase;
    const nextPhase = this.getNextPhase(currentPhase);
    
    if (!nextPhase) return; // No next phase (already at evolution-lock or error)

    const requirements = PHASE_TRANSITIONS[currentPhase];
    if (!requirements) return;

    const canTransition = this.canTransitionToPhase(nextPhase, requirements);
    
    if (canTransition && !requirements.adminApproval) {
      // Auto-transition if no admin approval needed
      this.transitionToPhase(nextPhase);
    } else if (canTransition) {
      // Emit event for admin approval
      this.emit('phase-transition-ready', {
        fromPhase: currentPhase,
        toPhase: nextPhase,
        requiresApproval: true,
      });
    }
  }

  /**
   * Get the next phase in sequence
   */
  private getNextPhase(currentPhase: TrainingPhase): TrainingPhase | null {
    const phases: TrainingPhase[] = ['childhood', 'adolescence', 'adulthood', 'evolution-lock'];
    const currentIndex = phases.indexOf(currentPhase);
    
    if (currentIndex === -1 || currentIndex >= phases.length - 1) {
      return null;
    }
    
    return phases[currentIndex + 1];
  }

  /**
   * Check if transition requirements are met
   */
  private canTransitionToPhase(
    nextPhase: TrainingPhase,
    requirements: PhaseTransitionRequirements
  ): boolean {
    const currentMetrics = this.phaseMetrics.get(this.state.currentPhase);
    if (!currentMetrics) return false;

    // Check interaction count
    if (currentMetrics.interactions < requirements.minInteractions) {
      return false;
    }

    // Check days in phase
    const daysInPhase = (Date.now() - currentMetrics.startedAt) / (1000 * 60 * 60 * 24);
    if (daysInPhase < requirements.minDaysInPhase) {
      return false;
    }

    // Check required capabilities
    for (const capability of requirements.requiredCapabilities) {
      if (!this.capabilities.has(capability)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Manually transition to a specific phase
   */
  transitionToPhase(
    targetPhase: TrainingPhase,
    options?: {
      adminKey?: string;
      lockReason?: LockTriggerReason;
    }
  ): {
    success: boolean;
    message: string;
  } {
    const currentPhase = this.state.currentPhase;

    // Cannot transition from evolution-lock
    if (currentPhase === 'evolution-lock') {
      return {
        success: false,
        message: 'Cannot transition from Evolution Lock phase. Evolution is permanently disabled.',
      };
    }

    // Validate transition is forward (no going back except to evolution-lock)
    const phases: TrainingPhase[] = ['childhood', 'adolescence', 'adulthood', 'evolution-lock'];
    const currentIndex = phases.indexOf(currentPhase);
    const targetIndex = phases.indexOf(targetPhase);

    if (targetIndex <= currentIndex && targetPhase !== 'evolution-lock') {
      return {
        success: false,
        message: `Cannot transition backward from ${currentPhase} to ${targetPhase}.`,
      };
    }

    // End current phase
    const currentHistory = this.state.phaseHistory[this.state.phaseHistory.length - 1];
    if (currentHistory) {
      currentHistory.endedAt = Date.now();
    }

    // Get config for new phase
    let newConfig: PhaseConfig;
    if (targetPhase === 'evolution-lock') {
      newConfig = {
        phase: 'evolution-lock',
        evolutionEnabled: false,
        inferenceOnly: true,
        triggerReason: options?.lockReason || 'admin-manual',
      } as EvolutionLockPhaseConfig;
    } else {
      newConfig = DEFAULT_PHASE_CONFIGS[targetPhase];
    }

    // Update state
    this.state = {
      currentPhase: targetPhase,
      config: newConfig,
      phaseStartedAt: Date.now(),
      phaseHistory: [
        ...this.state.phaseHistory,
        {
          phase: targetPhase,
          startedAt: Date.now(),
        },
      ],
    };

    // Initialize metrics for new phase
    this.phaseMetrics.set(targetPhase, { interactions: 0, startedAt: Date.now() });

    log.info('Phase transition completed', {
      fromPhase: currentPhase,
      toPhase: targetPhase,
    });

    this.emit('phase-transitioned', {
      fromPhase: currentPhase,
      toPhase: targetPhase,
      transitionedAt: Date.now(),
    });

    return {
      success: true,
      message: `Successfully transitioned from ${currentPhase} to ${targetPhase}.`,
    };
  }

  /**
   * Trigger evolution lock (shortcut to Phase 4)
   */
  triggerEvolutionLock(
    reason: LockTriggerReason,
    triggeredBy: 'system' | 'admin'
  ): boolean {
    const result = this.transitionToPhase('evolution-lock', {
      lockReason: reason,
    });

    if (result.success) {
      log.error('Evolution Lock phase activated', {
        reason,
        triggeredBy,
      });
      
      this.emit('evolution-lock-activated', {
        reason,
        triggeredBy,
        activatedAt: Date.now(),
      });
    }

    return result.success;
  }

  /**
   * Get phase capabilities based on current phase
   */
  getPhaseCapabilities(): {
    paradoxProcessing: boolean;
    emotionalTensionProcessing: boolean;
    fullCognitiveFabric: boolean;
    multiModelOrchestration: boolean;
    boundaryTesting: boolean;
    manipulationMonitoring: boolean;
    adaptiveGrowth: boolean;
    externalWebAccess: boolean;
  } {
    const phase = this.state.currentPhase;
    const config = this.state.config;

    return {
      paradoxProcessing: phase !== 'childhood',
      emotionalTensionProcessing: phase !== 'childhood',
      fullCognitiveFabric: phase === 'adulthood',
      multiModelOrchestration: (config as AdolescencePhaseConfig).multiModelEnabled || phase === 'adulthood',
      boundaryTesting: (config as AdolescencePhaseConfig).boundaryTesting || false,
      manipulationMonitoring: phase === 'adulthood' || phase === 'evolution-lock',
      adaptiveGrowth: phase !== 'evolution-lock',
      externalWebAccess: (config as ChildhoodPhaseConfig).externalAccess !== 'limited',
    };
  }

  /**
   * Get phase progress
   */
  getPhaseProgress(): {
    currentPhase: TrainingPhase;
    phaseIndex: number;
    totalPhases: number;
    daysInPhase: number;
    interactionsInPhase: number;
    nextPhase: TrainingPhase | null;
    transitionRequirements: PhaseTransitionRequirements | null;
    requirementsMet: {
      interactions: boolean;
      days: boolean;
      capabilities: boolean;
    } | null;
  } {
    const phases: TrainingPhase[] = ['childhood', 'adolescence', 'adulthood', 'evolution-lock'];
    const phaseIndex = phases.indexOf(this.state.currentPhase);
    const nextPhase = this.getNextPhase(this.state.currentPhase);
    const requirements = PHASE_TRANSITIONS[this.state.currentPhase];
    
    const metrics = this.phaseMetrics.get(this.state.currentPhase);
    const daysInPhase = metrics 
      ? (Date.now() - metrics.startedAt) / (1000 * 60 * 60 * 24)
      : 0;
    
    let requirementsMet = null;
    if (requirements && metrics) {
      requirementsMet = {
        interactions: metrics.interactions >= requirements.minInteractions,
        days: daysInPhase >= requirements.minDaysInPhase,
        capabilities: requirements.requiredCapabilities.every(c => this.capabilities.has(c)),
      };
    }

    return {
      currentPhase: this.state.currentPhase,
      phaseIndex,
      totalPhases: phases.length,
      daysInPhase: Math.floor(daysInPhase),
      interactionsInPhase: metrics?.interactions || 0,
      nextPhase,
      transitionRequirements: requirements,
      requirementsMet,
    };
  }

  /**
   * Get phase history
   */
  getPhaseHistory(): Array<{ phase: TrainingPhase; startedAt: number; endedAt?: number }> {
    return [...this.state.phaseHistory];
  }

  /**
   * Check if in evolution-locked state
   */
  isEvolutionLocked(): boolean {
    return this.state.currentPhase === 'evolution-lock';
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get statistics
   */
  getStats(): {
    currentPhase: TrainingPhase;
    totalInteractions: number;
    totalCapabilities: number;
    phasesCompleted: number;
    isEvolutionLocked: boolean;
  } {
    return {
      currentPhase: this.state.currentPhase,
      totalInteractions: this.interactionCount,
      totalCapabilities: this.capabilities.size,
      phasesCompleted: this.state.phaseHistory.filter(h => h.endedAt).length,
      isEvolutionLocked: this.isEvolutionLocked(),
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: TrainingPhaseSystem | null = null;

export function getTrainingPhaseSystem(): TrainingPhaseSystem {
  if (!instance) {
    instance = new TrainingPhaseSystem();
  }
  return instance;
}

export function resetTrainingPhaseSystem(): void {
  instance = null;
}

export default TrainingPhaseSystem;
