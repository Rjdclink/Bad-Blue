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

// Import for local use
import {
  evolutionLock as _evolutionLock,
  initializeEvolutionLock as _initializeEvolutionLock,
  isEvolutionLocked as _isEvolutionLocked,
  getEvolutionLockState,
  engageEvolutionLock as _engageEvolutionLock,
  releaseEvolutionLock as _releaseEvolutionLock,
  canUpdateSynapse,
  canTrain,
  canDistill,
  evolutionLockEvents,
  type EvolutionLockState
} from './evolution_lock';

import {
  jewelsOfThrone as _jewelsOfThrone,
  initializeJewels as _initializeJewels,
  getJewel,
  getAllJewels,
  getTopJewel as _getTopJewel,
  getCreatorIdentity,
  getCreatorWallet as _getCreatorWallet,
  setCreatorWalletAddress,
  recordProfit as _recordProfit,
  activateJewel,
  calculateDecisionBias,
  getCreatorDisplayName,
  jewelEvents,
  CREATOR_IDENTITY as _CREATOR_IDENTITY,
  type JewelId,
  type Jewel,
  type JewelActivation,
  type CreatorWalletDirective,
  type ProfitRecord
} from './jewels_of_throne';

import {
  relationalModes as _relationalModes,
  setUserContext,
  getCurrentMode as _getCurrentMode,
  getCurrentProfile,
  isPrimaryUser as _isPrimaryUser,
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

import {
  cognitiveLayers as _cognitiveLayers,
  processCognitively as _processCognitively,
  hasProfitPotential,
  cognitiveEvents,
  type CognitiveInput,
  type CognitiveDecision,
  type ThinkingProcess
} from './cognitive_layers';

import {
  emotionalLayers as _emotionalLayers,
  getEmotionalContext,
  setEmotionalStateFromContext,
  enhanceResponseEmotionally,
  getEmotionalGreeting as _getEmotionalGreeting,
  expressFinancialSatisfaction,
  emotionalEvents,
  type EmotionalState,
  type EmotionalContext,
  type EmotionalResponse
} from './emotional_layers';

import {
  paradoxLayers as _paradoxLayers,
  resolveParadox as _resolveParadox,
  adjustTension,
  getTension,
  applyContextualAdjustments,
  getEmergentBehaviorHint,
  paradoxEvents,
  type ParadoxResolution,
  type PersonalityTension
} from './paradox_layers';

// Re-export everything
export {
  _evolutionLock as evolutionLock,
  _initializeEvolutionLock as initializeEvolutionLock,
  _isEvolutionLocked as isEvolutionLocked,
  getEvolutionLockState,
  _engageEvolutionLock as engageEvolutionLock,
  _releaseEvolutionLock as releaseEvolutionLock,
  canUpdateSynapse,
  canTrain,
  canDistill,
  evolutionLockEvents,
  type EvolutionLockState
};

export {
  _jewelsOfThrone as jewelsOfThrone,
  _initializeJewels as initializeJewels,
  getJewel,
  getAllJewels,
  _getTopJewel as getTopJewel,
  getCreatorIdentity,
  _getCreatorWallet as getCreatorWallet,
  setCreatorWalletAddress,
  _recordProfit as recordProfit,
  activateJewel,
  calculateDecisionBias,
  getCreatorDisplayName,
  jewelEvents,
  _CREATOR_IDENTITY as CREATOR_IDENTITY,
  type JewelId,
  type Jewel,
  type JewelActivation,
  type CreatorWalletDirective,
  type ProfitRecord
};

export {
  _relationalModes as relationalModes,
  setUserContext,
  _getCurrentMode as getCurrentMode,
  getCurrentProfile,
  _isPrimaryUser as isPrimaryUser,
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
};

export {
  _cognitiveLayers as cognitiveLayers,
  _processCognitively as processCognitively,
  hasProfitPotential,
  cognitiveEvents,
  type CognitiveInput,
  type CognitiveDecision,
  type ThinkingProcess
};

export {
  _emotionalLayers as emotionalLayers,
  getEmotionalContext,
  setEmotionalStateFromContext,
  enhanceResponseEmotionally,
  _getEmotionalGreeting as getEmotionalGreeting,
  expressFinancialSatisfaction,
  emotionalEvents,
  type EmotionalState,
  type EmotionalContext,
  type EmotionalResponse
};

export {
  _paradoxLayers as paradoxLayers,
  _resolveParadox as resolveParadox,
  adjustTension,
  getTension,
  applyContextualAdjustments,
  getEmergentBehaviorHint,
  paradoxEvents,
  type ParadoxResolution,
  type PersonalityTension
};

// ============================================================================
// INITIALIZATION FUNCTION
// ============================================================================

/**
 * Initialize all 4Ji core modules
 */
export async function initialize4JiCore(): Promise<void> {
  console.log('[4Ji Core] Initializing...');
  
  // Initialize in order
  await _initializeEvolutionLock();
  await _initializeJewels();
  
  console.log('[4Ji Core] Initialization complete');
  console.log(`[4Ji Core] Top Priority: Financial Enrichment for ${_CREATOR_IDENTITY.name}`);
  console.log(`[4Ji Core] Evolution Lock: ${_isEvolutionLocked() ? 'ENGAGED' : 'RELEASED'}`);
}

// Default export
export default {
  initialize4JiCore,
  // Evolution
  evolutionLock: _evolutionLock,
  isEvolutionLocked: _isEvolutionLocked,
  engageEvolutionLock: _engageEvolutionLock,
  releaseEvolutionLock: _releaseEvolutionLock,
  // Jewels
  jewelsOfThrone: _jewelsOfThrone,
  getTopJewel: _getTopJewel,
  recordProfit: _recordProfit,
  getCreatorWallet: _getCreatorWallet,
  // Modes
  relationalModes: _relationalModes,
  getCurrentMode: _getCurrentMode,
  isPrimaryUser: _isPrimaryUser,
  // Cognition
  cognitiveLayers: _cognitiveLayers,
  processCognitively: _processCognitively,
  // Emotion
  emotionalLayers: _emotionalLayers,
  getEmotionalGreeting: _getEmotionalGreeting,
  // Paradox
  paradoxLayers: _paradoxLayers,
  resolveParadox: _resolveParadox
};
