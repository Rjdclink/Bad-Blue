/**
 * 4Ji Core Module - Index
 * 
 * The central intelligence of 4Ji (Forgai), seated on the Omniscient
 * Computational Reactor throne.
 * 
 * Core Components:
 * - Evolution Lock: Controls whether 4Ji can evolve
 * - Jewels of Throne: 10 core motivational constructs (Financial Enrichment is #1)
 * - Relational Modes: Mode A (Creator) vs Mode B (Others)
 * - Cognitive Layers: How 4Ji thinks
 * - Emotional Layers: How 4Ji feels
 * - Paradox Layers: Complex personality management
 */

// Evolution Lock
export {
  evolutionLock,
  initializeEvolutionLock,
  isEvolutionLocked,
  getEvolutionLockState,
  engageEvolutionLock,
  releaseEvolutionLock,
  canUpdateSynapse,
  canTrain,
  canDistill,
  evolutionLockEvents,
  type EvolutionLockState
} from './evolution_lock';

// Jewels of the Throne
export {
  jewelsOfThrone,
  initializeJewels,
  getJewel,
  getAllJewels,
  getTopJewel,
  getCreatorIdentity,
  getCreatorWallet,
  setCreatorWalletAddress,
  recordProfit,
  activateJewel,
  calculateDecisionBias,
  getCreatorDisplayName,
  jewelEvents,
  CREATOR_IDENTITY,
  type JewelId,
  type Jewel,
  type JewelActivation,
  type CreatorWalletDirective,
  type ProfitRecord
} from './jewels_of_throne';

// Relational Modes
export {
  relationalModes,
  setUserContext,
  getCurrentMode,
  getCurrentProfile,
  isPrimaryUser,
  getToneParameters,
  getResponseModifiers,
  getGreetingStyle,
  shouldUseEndearment,
  relationalModeEvents,
  type RelationalMode,
  type ModeAProfile,
  type ModeBProfile,
  type RelationalProfile,
  type UserContext
} from './relational_modes';

// Cognitive Layers
export {
  cognitiveLayers,
  processCognitively,
  hasProfitPotential,
  cognitiveEvents,
  type CognitiveInput,
  type CognitiveDecision,
  type ThinkingProcess
} from './cognitive_layers';

// Emotional Layers
export {
  emotionalLayers,
  getEmotionalContext,
  setEmotionalStateFromContext,
  enhanceResponseEmotionally,
  getEmotionalGreeting,
  expressFinancialSatisfaction,
  emotionalEvents,
  type EmotionalState,
  type EmotionalContext,
  type EmotionalResponse
} from './emotional_layers';

// Paradox Layers
export {
  paradoxLayers,
  resolveParadox,
  adjustTension,
  getTension,
  applyContextualAdjustments,
  getEmergentBehaviorHint,
  paradoxEvents,
  type ParadoxResolution,
  type PersonalityTension
} from './paradox_layers';

// ============================================================================
// INITIALIZATION FUNCTION
// ============================================================================

/**
 * Initialize all 4Ji core modules
 */
export async function initialize4JiCore(): Promise<void> {
  console.log('[4Ji Core] Initializing...');
  
  // Initialize in order
  await initializeEvolutionLock();
  await initializeJewels();
  
  console.log('[4Ji Core] Initialization complete');
  console.log(`[4Ji Core] Top Priority: Financial Enrichment for ${CREATOR_IDENTITY.name}`);
  console.log(`[4Ji Core] Evolution Lock: ${isEvolutionLocked() ? 'ENGAGED' : 'RELEASED'}`);
}

// Default export
export default {
  initialize4JiCore,
  // Evolution
  evolutionLock,
  isEvolutionLocked,
  engageEvolutionLock,
  releaseEvolutionLock,
  // Jewels
  jewelsOfThrone,
  getTopJewel,
  recordProfit,
  getCreatorWallet,
  // Modes
  relationalModes,
  getCurrentMode,
  isPrimaryUser,
  // Cognition
  cognitiveLayers,
  processCognitively,
  // Emotion
  emotionalLayers,
  getEmotionalGreeting,
  // Paradox
  paradoxLayers,
  resolveParadox
};
