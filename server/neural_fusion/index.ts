/**
 * Neural Fusion Module - Index
 * 
 * Exports the Neural Fusion Engine for multi-model output merging
 */

export {
  neuralFusionEngine,
  initializeNeuralFusion,
  fuseResponses,
  getFusionStats,
  shutdownNeuralFusion,
  neuralFusionEvents,
  type CandidateResponse,
  type FusionContext,
  type FusionProfile,
  type FusionResult,
  type ScoredResponse
} from './neuralFusionEngine';

import neuralFusionEngineDefault from './neuralFusionEngine';
export default neuralFusionEngineDefault;
