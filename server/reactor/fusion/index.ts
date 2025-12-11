/**
 * Reactor Fusion - Index
 */

export {
  neuralFusionEngine,
  configureFusion,
  fuseResponses,
  fusionEvents,
  type CandidateResponse,
  type ScoringWeights,
  type FusionResult,
  type FusionConfig
} from './neural_fusion_engine';

export {
  monteCarloAdapter,
  evaluateWithMonteCarlo,
  evaluateCryptoStrategy,
  evaluateOsintAccuracy,
  evaluateLegalResearch,
  monteCarloEvents,
  type MonteCarloOptions,
  type MonteCarloResult,
  type Scenario
} from './monte_carlo_adapter';
