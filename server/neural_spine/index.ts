/**
 * Neural Spine Module - Index
 * 
 * The Neural Spine is the shared brainstem for all agents:
 * - Kriptera (sensorimotor / crypto / data hunting)
 * - Lexara (speech + interface)
 * - 4Ji (executive cortex)
 * 
 * "Nodes that fire together, wire together" - stored in Supabase.
 */

// Core modules
export {
  spineHub,
  initializeSpineHub,
  recordExperience,
  querySynapses,
  getSynapsesForContext,
  recordCrossRegionExperience,
  getSpineHubStatus,
  shutdownSpineHub,
  spineHubEvents,
  type RecordExperienceInput,
  type QuerySynapsesInput,
  type SpineHubStatus
} from './spine_hub';

export {
  plasticityEngine,
  initializePlasticityEngine,
  updateSynapses,
  getPlasticityMetrics,
  shutdownPlasticityEngine,
  plasticityEvents,
  type ExperienceEvent,
  type PlasticityMetrics
} from './plasticity_engine';

export {
  synapseStore,
  initializeSynapseStore,
  type NeuralRegion,
  type NeuralSynapse,
  type NeuralEvent,
  type NeuralRegionId,
  type SourceAgent,
  type CreateSynapseInput,
  type CreateEventInput,
  type SynapseQuery,
  DEFAULT_DECAY_RATE,
  INITIAL_CONFIDENCE,
  BASE_WEIGHT
} from './synapse_store';

export {
  makeFingerprint,
  makeInputFingerprint,
  makeOutputFingerprint,
  makeContextHash,
  fingerprintSimilarity,
  areFingerprintsSimilar,
  type FingerprintEvent,
  type FingerprintOptions
} from './context_fingerprint';

// Integration adapters
export {
  kripteraAdapter,
  recordCrawlExperience,
  recordMonteCarloExperience,
  recordArbitrageExperience,
  getKripteraPatternHints,
  getBestCrawlerConfig,
  type CrawlResult,
  type MonteCarloResult,
  type ArbitrageDecision,
  type KripteraPatternHint
} from './integration/kriptera_adapter';

export {
  lexaraAdapter,
  recordConversationExperience,
  recordCommandExperience,
  recordVoiceInteraction,
  getLexaraPatternHints,
  getBestResponseStrategy,
  type ConversationResult,
  type CommandResolution,
  type VoiceInteraction,
  type LexaraPatternHint
} from './integration/lexara_adapter';

export {
  fourJiAdapter,
  recordSubAgentTask,
  recordOrchestratorDecision,
  getFourJiPatternHints,
  getBestSubAgentCluster,
  getRecommendedLLMEnsemble,
  isEvolutionLocked,
  setEvolutionLock,
  getEvolutionLockState,
  type SubAgentTaskResult,
  type OrchestratorDecision,
  type EvolutionLockState,
  type FourJiPatternHint
} from './integration/fourji_adapter';

// Default export
import spineHubDefault from './spine_hub';
export default spineHubDefault;
