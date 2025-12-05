/**
 * ML/NLP Intelligence Service
 * 
 * Main service that integrates all ML/NLP workers into the OSINT pipeline
 * Provides a clean API for the People Finder system
 */

import { workerOrchestrator } from './workerOrchestrator';
import { nlpTextWorker, NLPResult } from './nlpTextWorker';
import { mlEntityResolutionWorker, EntityRecord, ResolvedEntity } from './mlEntityResolutionWorker';
import { mlConfidenceScoringWorker, EntityConfidenceScore } from './mlConfidenceScoringWorker';
import { logger } from '../../logger';

export interface MLNLPProcessingOptions {
  enableNLP?: boolean;
  enableEntityResolution?: boolean;
  enableConfidenceScoring?: boolean;
  parallel?: boolean;
}

export interface MLNLPResult {
  nlpResults?: NLPResult;
  resolvedEntities?: ResolvedEntity[];
  confidenceScores?: EntityConfidenceScore[];
  processingTime: number;
  workersExecuted: string[];
  success: boolean;
  errors?: string[];
}

/**
 * ML/NLP Intelligence Service
 */
class MLNLPIntelligenceService {
  private initialized = false;

  /**
   * Initialize the service and register workers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Register workers
      workerOrchestrator.registerWorker(nlpTextWorker);
      workerOrchestrator.registerWorker(mlEntityResolutionWorker);
      workerOrchestrator.registerWorker(mlConfidenceScoringWorker);

      // Health check
      const health = await workerOrchestrator.healthCheckAll();
      const allHealthy = Object.values(health).every(h => h);

      if (!allHealthy) {
        logger.warn('[ML/NLP Intelligence] Some workers failed health check:', health);
      } else {
        logger.info('[ML/NLP Intelligence] All workers healthy and ready');
      }

      this.initialized = true;
    } catch (error) {
      logger.error('[ML/NLP Intelligence] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Process text through NLP pipeline
   */
  async processText(
    text: string,
    metadata?: Record<string, any>
  ): Promise<NLPResult | null> {
    await this.initialize();

    try {
      const result = await workerOrchestrator.executeWorker('nlp_text_worker', {
        text,
        metadata,
      });

      if (result.success && result.data) {
        return result.data as NLPResult;
      }

      logger.warn('[ML/NLP Intelligence] NLP processing failed:', result.error);
      return null;
    } catch (error) {
      logger.error('[ML/NLP Intelligence] Text processing error:', error);
      return null;
    }
  }

  /**
   * Resolve entities across multiple records
   */
  async resolveEntities(records: EntityRecord[]): Promise<ResolvedEntity[]> {
    await this.initialize();

    try {
      const result = await workerOrchestrator.executeWorker('ml_entity_resolution_worker', {
        entities: records,
      });

      if (result.success && result.data) {
        return result.data.resolvedEntities || [];
      }

      logger.warn('[ML/NLP Intelligence] Entity resolution failed:', result.error);
      return [];
    } catch (error) {
      logger.error('[ML/NLP Intelligence] Entity resolution error:', error);
      return [];
    }
  }

  /**
   * Score entity confidence
   */
  async scoreEntities(entities: any[]): Promise<EntityConfidenceScore[]> {
    await this.initialize();

    try {
      const result = await workerOrchestrator.executeWorker('ml_confidence_scoring_worker', {
        entities,
      });

      if (result.success && result.data) {
        return result.data as EntityConfidenceScore[];
      }

      logger.warn('[ML/NLP Intelligence] Confidence scoring failed:', result.error);
      return [];
    } catch (error) {
      logger.error('[ML/NLP Intelligence] Confidence scoring error:', error);
      return [];
    }
  }

  /**
   * Full ML/NLP pipeline - processes text, resolves entities, and scores confidence
   */
  async processFullPipeline(
    text: string,
    existingRecords?: EntityRecord[],
    options: MLNLPProcessingOptions = {}
  ): Promise<MLNLPResult> {
    const startTime = Date.now();
    const workersExecuted: string[] = [];
    const errors: string[] = [];

    const {
      enableNLP = true,
      enableEntityResolution = true,
      enableConfidenceScoring = true,
      parallel = false,
    } = options;

    await this.initialize();

    const result: MLNLPResult = {
      processingTime: 0,
      workersExecuted,
      success: false,
    };

    try {
      // Step 1: NLP text processing
      let nlpResults: NLPResult | null = null;
      if (enableNLP && text) {
        nlpResults = await this.processText(text);
        workersExecuted.push('nlp_text_worker');

        if (nlpResults) {
          result.nlpResults = nlpResults;
        } else {
          errors.push('NLP processing failed');
        }
      }

      // Step 2: Build entity records from NLP results
      const entityRecords: EntityRecord[] = [];

      // Add entities from NLP
      if (nlpResults && nlpResults.entities) {
        nlpResults.entities.forEach(entity => {
          const record: EntityRecord = {
            name: entity.type === 'person' ? entity.value : '',
            source: 'nlp_extraction',
            confidence: entity.confidence * 100,
            metadata: {
              entityType: entity.type,
              sourceText: entity.sourceText,
            },
          };

          if (entity.type === 'email') {
            record.email = entity.value;
          } else if (entity.type === 'phone') {
            record.phone = entity.value;
          } else if (entity.type === 'location') {
            record.location = entity.value;
          } else if (entity.type === 'org') {
            record.organization = entity.value;
          }

          if (record.name || record.email || record.phone) {
            entityRecords.push(record);
          }
        });
      }

      // Add existing records
      if (existingRecords && existingRecords.length > 0) {
        entityRecords.push(...existingRecords);
      }

      // Step 3: Entity resolution
      let resolvedEntities: ResolvedEntity[] = [];
      if (enableEntityResolution && entityRecords.length > 0) {
        resolvedEntities = await this.resolveEntities(entityRecords);
        workersExecuted.push('ml_entity_resolution_worker');

        if (resolvedEntities.length > 0) {
          result.resolvedEntities = resolvedEntities;
        } else {
          errors.push('Entity resolution produced no results');
        }
      }

      // Step 4: Confidence scoring
      let confidenceScores: EntityConfidenceScore[] = [];
      if (enableConfidenceScoring) {
        const entitiesToScore = resolvedEntities.length > 0 
          ? resolvedEntities 
          : entityRecords;

        if (entitiesToScore.length > 0) {
          confidenceScores = await this.scoreEntities(entitiesToScore);
          workersExecuted.push('ml_confidence_scoring_worker');

          if (confidenceScores.length > 0) {
            result.confidenceScores = confidenceScores;
          } else {
            errors.push('Confidence scoring produced no results');
          }
        }
      }

      result.success = errors.length === 0 || 
        (result.nlpResults !== undefined || 
         result.resolvedEntities !== undefined || 
         result.confidenceScores !== undefined);

    } catch (error) {
      logger.error('[ML/NLP Intelligence] Full pipeline error:', error);
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      result.success = false;
    }

    result.processingTime = Date.now() - startTime;
    if (errors.length > 0) {
      result.errors = errors;
    }

    return result;
  }

  /**
   * Process OSINT data through ML/NLP pipeline
   * Integrates with People Finder OSINT results
   */
  async processOSINTData(osintData: {
    text?: string;
    entities?: EntityRecord[];
    sources?: any[];
  }): Promise<MLNLPResult> {
    const combinedText = [
      osintData.text || '',
      ...(osintData.sources || []).map((s: any) => 
        JSON.stringify(s.data || s)
      ),
    ].filter(t => t.length > 0).join('\n\n');

    return this.processFullPipeline(
      combinedText,
      osintData.entities,
      {
        enableNLP: true,
        enableEntityResolution: true,
        enableConfidenceScoring: true,
      }
    );
  }

  /**
   * Get health status of all workers
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    workers: Record<string, boolean>;
  }> {
    await this.initialize();

    const workers = await workerOrchestrator.healthCheckAll();
    const healthy = Object.values(workers).every(h => h);

    return { healthy, workers };
  }

  /**
   * Get registered workers
   */
  getRegisteredWorkers(): string[] {
    return workerOrchestrator.getRegisteredWorkers();
  }
}

// Singleton instance
export const mlnlpIntelligenceService = new MLNLPIntelligenceService();
