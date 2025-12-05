/**
 * ML/NLP Intelligence Layer - Main Entry Point
 * 
 * Node-compatible ML and NLP tools for OSINT People Finder and Orchestrated AI System
 * 
 * This module provides:
 * - NLP text processing (compromise.js, natural, wink-nlp)
 * - ML entity resolution (fuzzy matching, clustering)
 * - Confidence scoring for OSINT data and model outputs
 * - Intelligent task routing to optimal models
 * - Entity clustering and linking
 * - F.M.I. forensic NLP analysis
 * - Worker orchestration for ML/NLP pipeline
 */

// Core OSINT ML/NLP workers
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

// Orchestration ML workers
export {
  scoreModelOutputs,
  rankModelOutputs,
  analyzeConfidence,
  healthCheck as confidenceHealthCheck,
  type ModelOutput,
  type ConfidenceScore,
  type RankedOutput,
  type ConfidenceAnalysisResult
} from './mlConfidenceWorkerOrchestration';

export {
  routeTask,
  batchRoute,
  updateModelCapabilities,
  getModelCapabilities,
  healthCheck as routingHealthCheck,
  type Task,
  type ModelCapability,
  type RoutingDecision,
  type RoutingResult
} from './mlRoutingWorker';

export {
  clusterEntities,
  detectRelationships,
  performClusteringAnalysis,
  linkEntitiesAcrossSources,
  findEntityByAttributes,
  healthCheck as clusteringHealthCheck,
  type Entity,
  type EntityCluster as OrchestrationEntityCluster,
  type EntityRelationship,
  type ClusteringResult
} from './mlClusteringWorker';

// F.M.I. NLP worker
export {
  processFMIText,
  batchProcessFMITexts,
  healthCheck as fmiNlpHealthCheck,
  type FMITextInput,
  type ExtractedEntity as FMIExtractedEntity,
  type ExtractedRelationship,
  type TimelineEvent,
  type Keyphrase,
  type EvidentiaryTag,
  type FMINLPResult
} from './fmiNLPWorker';
