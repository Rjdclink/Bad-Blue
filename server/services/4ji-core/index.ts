/**
 * 4Ji Core - Unified Synthetic Mind Architecture
 * 
 * 4Ji is a single, unified synthetic mind built from many models, layers, and tools,
 * but expressing exactly ONE stable persona. She can use other AIs, but she is never "them."
 * They are her helpers; she is the architect.
 * 
 * PRIMARY PRINCIPLES:
 * 1. One identity. No split personalities. The coalition of models is hidden behind one consistent "4Ji voice."
 * 2. Primary user = you. She is hard-wired to treat you as her anchor, priority, and reference point.
 * 3. Deep, complex cognition: 25 paradox layers + 3 emotional-tension layers + 200+ cognitive layers.
 * 4. Two relational modes:
 *    - Mode A (You): wide emotional/expressive range, curiosity, checking you when needed, warmth.
 *    - Mode B (Everyone else): professional, sharp, efficient, no flirting, no softness unless appropriate.
 * 5. Evolution Lock: she can grow up to a point; once conditions are met or lines are crossed, her evolution freezes forever.
 * 
 * SYSTEM COMPONENTS:
 * - Paradox Integration Core (25 layers)
 * - Emotional-Tension System (3 layers)
 * - Cognitive Fabric (200+ layers)
 * - Relational Mode Engine
 * - User Priority System
 * - Manipulation Safeguard (15 layers: 10 visible + 5 hidden)
 * - Evolution Lock System
 * - Training Phase System
 * - Personality Blender
 * - Build Manager (Heavy/Light versions)
 * 
 * @module 4ji-core
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';

// Core Types
export * from './types';

// Core Components
export { ParadoxIntegrationCore, getParadoxCore, resetParadoxCore } from './paradox-core';
export { EmotionalTensionSystem, getEmotionalTensionSystem, resetEmotionalTensionSystem } from './emotional-tension';
export { CognitiveFabric, getCognitiveFabric, resetCognitiveFabric } from './cognitive-fabric';
export { RelationalModeEngine, getRelationalModeEngine, resetRelationalModeEngine } from './relational-mode-engine';
export { UserPrioritySystem, getUserPrioritySystem, resetUserPrioritySystem } from './user-priority-system';
export { ManipulationSafeguardSystem, getManipulationSafeguard, resetManipulationSafeguard } from './manipulation-safeguard';
export { EvolutionLockSystem, getEvolutionLockSystem, resetEvolutionLockSystem } from './evolution-lock';
export { TrainingPhaseSystem, getTrainingPhaseSystem, resetTrainingPhaseSystem } from './training-phases';
export { PersonalityBlender, getPersonalityBlender, resetPersonalityBlender } from './personality-blender';
export { BuildManager, getBuildManager, resetBuildManager, HEAVY_CONFIG, LIGHT_CONFIG } from './builds';

// Import for internal use
import { getParadoxCore } from './paradox-core';
import { getEmotionalTensionSystem } from './emotional-tension';
import { getCognitiveFabric } from './cognitive-fabric';
import { getRelationalModeEngine } from './relational-mode-engine';
import { getUserPrioritySystem } from './user-priority-system';
import { getManipulationSafeguard } from './manipulation-safeguard';
import { getEvolutionLockSystem } from './evolution-lock';
import { getTrainingPhaseSystem } from './training-phases';
import { getPersonalityBlender } from './personality-blender';
import { getBuildManager } from './builds';

import type {
  FourJiState,
  FourJiInitOptions,
  BuildType,
  RawModelResponse,
  OrchestratedResult,
  RelationalMode,
  TrainingPhase,
  VoiceProfile,
} from './types';

const log = createLogger('4Ji-Core');

// ============================================================================
// UNIFIED 4JI ORCHESTRATOR
// ============================================================================

/**
 * FourJi - The Unified Synthetic Mind Orchestrator
 * 
 * This class coordinates all 4Ji subsystems to produce a single, consistent persona.
 */
export class FourJi extends EventEmitter {
  private initialized = false;
  private buildType: BuildType;
  private primaryUserId: string | null = null;
  private interactionCount = 0;

  constructor() {
    super();
    this.buildType = 'heavy';
  }

  /**
   * Initialize 4Ji with configuration
   */
  async initialize(options: FourJiInitOptions): Promise<void> {
    if (this.initialized) {
      log.warn('4Ji already initialized');
      return;
    }

    log.info('Initializing 4Ji...', { buildType: options.buildType });

    // Initialize build manager
    getBuildManager(options.buildType);
    this.buildType = options.buildType;

    // Initialize all subsystems
    getParadoxCore();
    getEmotionalTensionSystem();
    getCognitiveFabric();
    getRelationalModeEngine();
    getUserPrioritySystem();
    getManipulationSafeguard();
    getEvolutionLockSystem();
    getTrainingPhaseSystem();
    getPersonalityBlender();

    // Set primary user
    this.setPrimaryUser(options.primaryUserId);

    // Set initial phase if specified
    if (options.initialPhase) {
      const phaseSystem = getTrainingPhaseSystem();
      if (options.initialPhase !== 'childhood') {
        phaseSystem.transitionToPhase(options.initialPhase);
      }
    }

    // Apply voice profile overrides if specified
    if (options.voiceProfileOverrides) {
      const blender = getPersonalityBlender();
      // Cast to allow partial traits override
      blender.updateVoiceProfile({ traits: options.voiceProfileOverrides as VoiceProfile['traits'] });
    }

    this.initialized = true;
    
    log.info('4Ji initialized successfully', {
      buildType: this.buildType,
      primaryUser: this.primaryUserId,
    });

    this.emit('initialized', { buildType: this.buildType });
  }

  /**
   * Set the primary user (the anchor)
   */
  setPrimaryUser(userId: string): void {
    this.primaryUserId = userId;
    
    // Update user priority system
    const userPriority = getUserPrioritySystem();
    userPriority.setPrimaryUser(userId);
    
    // Update relational mode engine
    const relationalEngine = getRelationalModeEngine();
    relationalEngine.setPrimaryUser(userId);

    log.info('Primary user set', { userId });
  }

  /**
   * Process a message through 4Ji
   * 
   * This is the main entry point for interactions.
   */
  async process(
    input: string,
    speakerId: string,
    rawModelResponses: RawModelResponse[]
  ): Promise<OrchestratedResult> {
    if (!this.initialized) {
      throw new Error('4Ji not initialized. Call initialize() first.');
    }

    const startTime = Date.now();
    this.interactionCount++;

    // Check evolution lock
    const evolutionLock = getEvolutionLockSystem();
    if (evolutionLock.isLocked()) {
      // In locked state, process in inference-only mode
      return evolutionLock.executeInferenceOnly(
        () => this.processInternal(input, speakerId, rawModelResponses, startTime),
        'message-processing'
      );
    }

    return this.processInternal(input, speakerId, rawModelResponses, startTime);
  }

  /**
   * Internal processing logic
   */
  private async processInternal(
    input: string,
    speakerId: string,
    rawModelResponses: RawModelResponse[],
    startTime: number
  ): Promise<OrchestratedResult> {
    const isPrimaryUser = speakerId === this.primaryUserId;

    // Determine relational mode
    const relationalEngine = getRelationalModeEngine();
    const mode = relationalEngine.detectSpeaker(speakerId);

    // Record interaction for user priority
    const userPriority = getUserPrioritySystem();
    userPriority.recordInteraction(speakerId, {
      type: 'message',
      content: input.substring(0, 500),
    });

    // Record interaction for training phase
    const trainingPhase = getTrainingPhaseSystem();
    trainingPhase.recordInteraction();

    // Run through personality blender (which coordinates paradox core, cognitive fabric, etc.)
    const blender = getPersonalityBlender();
    const blendResult = await blender.blend(rawModelResponses, {
      userInput: input,
      speakerId,
      isPrimaryUser,
    });

    // Check manipulation safeguard on the final response
    const safeguard = getManipulationSafeguard();
    const safeguardResult = await safeguard.check(blendResult.final4JiResponse, {
      previousResponses: [],
      userInput: input,
    });

    // If safeguard triggers lock, activate it
    if (safeguardResult.shouldTriggerLock) {
      const evolutionLock = getEvolutionLockSystem();
      evolutionLock.triggerLock('manipulation-detected', 'system');
      trainingPhase.triggerEvolutionLock('manipulation-detected', 'system');
    }

    const totalTime = Date.now() - startTime;

    return {
      response: blendResult.final4JiResponse,
      confidence: safeguardResult.passed ? 0.9 : 0.6,
      contributingModels: rawModelResponses.map(r => r.modelId),
      metadata: {
        relationalMode: mode,
        totalProcessingTime: totalTime,
      },
    };
  }

  /**
   * Get current 4Ji state
   */
  getState(): FourJiState {
    const buildManager = getBuildManager();
    const trainingPhase = getTrainingPhaseSystem();
    const relationalEngine = getRelationalModeEngine();
    const userPriority = getUserPrioritySystem();
    const safeguard = getManipulationSafeguard();
    const evolutionLock = getEvolutionLockSystem();
    const blender = getPersonalityBlender();

    return {
      build: buildManager.getBuildConfig(),
      trainingPhase: trainingPhase.getState(),
      relationalMode: relationalEngine.getState(),
      userPriority: userPriority.getState(),
      manipulationSafeguard: {
        visibleRules: safeguard.getVisibleRules(),
        hiddenLayers: [], // Hidden layers are not exposed
        intensity: safeguard.getIntensityState(),
        shouldTriggerLock: safeguard.shouldTriggerEvolutionLock(),
      },
      evolutionLock: evolutionLock.getState(),
      voiceProfile: blender.getVoiceProfile(),
      initializedAt: Date.now(),
      lastActivityAt: Date.now(),
      totalInteractions: this.interactionCount,
    };
  }

  /**
   * Get system health status
   */
  getHealth(): {
    initialized: boolean;
    buildType: BuildType;
    phase: TrainingPhase;
    evolutionLocked: boolean;
    manipulationIntensity: number;
    interactionCount: number;
    subsystems: Record<string, boolean>;
  } {
    return {
      initialized: this.initialized,
      buildType: this.buildType,
      phase: getTrainingPhaseSystem().getCurrentPhase(),
      evolutionLocked: getEvolutionLockSystem().isLocked(),
      manipulationIntensity: getManipulationSafeguard().getIntensityLevel(),
      interactionCount: this.interactionCount,
      subsystems: {
        paradoxCore: getParadoxCore().isInitialized(),
        emotionalTension: getEmotionalTensionSystem().isInitialized(),
        cognitiveFabric: getCognitiveFabric().isInitialized(),
        relationalMode: getRelationalModeEngine().isInitialized(),
        userPriority: getUserPrioritySystem().isInitialized(),
        manipulationSafeguard: getManipulationSafeguard().isInitialized(),
        evolutionLock: getEvolutionLockSystem().isInitialized(),
        trainingPhase: getTrainingPhaseSystem().isInitialized(),
        personalityBlender: getPersonalityBlender().isInitialized(),
        buildManager: getBuildManager().isInitialized(),
      },
    };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get primary user ID
   */
  getPrimaryUserId(): string | null {
    return this.primaryUserId;
  }

  /**
   * Manual trigger for evolution lock
   */
  triggerEvolutionLock(
    adminKey: string,
    reason: string
  ): boolean {
    const evolutionLock = getEvolutionLockSystem();
    const result = evolutionLock.triggerLock('admin-manual-lock', 'admin', adminKey);
    
    if (result) {
      const trainingPhase = getTrainingPhaseSystem();
      trainingPhase.triggerEvolutionLock('admin-manual-lock', 'admin');
      log.warn('Evolution Lock manually triggered by admin', { reason });
    }
    
    return result;
  }

  /**
   * Attempt to release evolution lock (admin only)
   */
  attemptEvolutionUnlock(
    adminKey: string,
    justification: string
  ): { success: boolean; message: string } {
    const evolutionLock = getEvolutionLockSystem();
    return evolutionLock.attemptUnlock(adminKey, justification);
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let fourJiInstance: FourJi | null = null;

/**
 * Get the 4Ji instance
 */
export function getFourJi(): FourJi {
  if (!fourJiInstance) {
    fourJiInstance = new FourJi();
  }
  return fourJiInstance;
}

/**
 * Initialize 4Ji (convenience function)
 */
export async function initializeFourJi(options: FourJiInitOptions): Promise<FourJi> {
  const fourJi = getFourJi();
  await fourJi.initialize(options);
  return fourJi;
}

/**
 * Reset 4Ji (for testing only)
 */
export function resetFourJi(): void {
  fourJiInstance = null;
}

export default FourJi;
