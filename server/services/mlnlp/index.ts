/**
 * ML/NLP Intelligence Layer - Main Entry Point
 * 
 * Node-compatible ML and NLP tools for OSINT People Finder
 * 
 * This module provides:
 * - NLP text processing (compromise.js, natural)
 * - ML entity resolution (fuzzy matching, clustering)
 * - Confidence scoring for OSINT data
 * - Worker orchestration for ML/NLP pipeline
 */

export { workerOrchestrator, Worker, WorkerInput, WorkerOutput } from './workerOrchestrator';
export { nlpTextWorker, NLPResult, ExtractedEntity } from './nlpTextWorker';
export { 
  mlEntityResolutionWorker, 
  EntityRecord, 
  ResolvedEntity,
  EntityCluster 
} from './mlEntityResolutionWorker';
export { 
  mlConfidenceScoringWorker, 
  AttributeScore,
  EntityConfidenceScore 
} from './mlConfidenceScoringWorker';
export { 
  mlnlpIntelligenceService,
  MLNLPProcessingOptions,
  MLNLPResult 
} from './intelligenceService';
