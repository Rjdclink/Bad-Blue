/**
 * Lexara Module - Index
 * 
 * Central exports for Lexara's power, voice, and intelligence systems.
 * Lexara operates on the Computational Reactor throne for all heavy processing.
 * 
 * Includes:
 * - LEXARA VOICE FORGE - Monte Carlo-driven voice optimization engine
 *   for discovering the perfect Lexara voice: young female (18-20) with centuries
 *   of court experience and calm, surgical clarity.
 * 
 * - MONTE CARLO ENHANCEMENT SYSTEM - Multi-layered optimization engine for
 *   legal reasoning, analytical review, consultative engagement, and vocal authority.
 *   Runs scheduled cycles (3 per day) and session-scoped evaluations at decision boundaries.
 */

// Power Core
export {
  ensureLexaraReactorInitialized,
  scheduleLexaraJob,
  getLexaraPowerState,
  isLexaraOperational,
  getLexaraReactorEvents,
  type LexaraJobType,
  type LexaraPowerState,
  type LexaraJobOptions,
} from './lexaraPowerCore';

// Persona Kernel
export {
  LEXARA_KERNEL,
  applyEmotionalModulation,
  mergePersonaWithKernel,
  validateLexaraPersona,
  type LexaraKernelType,
  type UserSentiment,
  type VoiceModulation,
} from './personaKernel';

// Voice Forge - Monte Carlo Voice Optimization
export {
  lexaraVoiceForge,
  runVoiceForgeSearch,
  configureVoiceForge,
  getVoiceForgeState,
  getActiveVoiceProfile,
  getVoiceForgeRewriter,
  LexaraPersonaRewriter,
  voiceForgeEvents,
  type VoiceCandidate,
  type FrozenVoiceProfile,
  type VoiceForgeConfig,
  type VoiceForgeState,
  type CandidateFitness,
  type PostFXProfile,
  type PausePattern,
} from './voiceForge';

// TTS Router - Multi-engine voice synthesis
export {
  lexaraTTSRouter,
  synthesizeLexaraSpeech,
  synthesizeLexaraSpeechStream,
  configureTTSRouter,
  getTTSEngineStatuses,
  getTTSCacheStats,
  ttsRouterEvents,
  type TTSRequest,
  type TTSResponse,
  type TTSStreamChunk,
  type TTSEngineConfig,
  type TTSEngineStatus,
} from './LexaraTTSRouter';

// Monte Carlo Enhancement System - Integrated optimization engine
export {
  lexaraMonteCarloEnhancement,
  initializeMonteCarloEnhancement,
  runOptimizationCycle,
  evaluateAtDecisionBoundary,
  configureEnhancement,
  configureEnhancementSchedule,
  getEnhancementState,
  getActiveOptimizationProfile,
  isEnhancementOptimizing,
  shutdownMonteCarloEnhancement,
  monteCarloEnhancementEvents,
  type OptimizationDomain,
  type LegalUnderstandingMetrics,
  type ExplanationQualityMetrics,
  type ConsultativeEngagementMetrics,
  type VocalGravitasMetrics,
  type OptimizationProfile,
  type MonteCarloEnhancementConfig,
  type SessionContext,
  type ScheduledCycleConfig,
  type EnhancementSystemState,
} from './monteCarloEnhancement';

import lexaraPowerCore from './lexaraPowerCore';
export default lexaraPowerCore;
