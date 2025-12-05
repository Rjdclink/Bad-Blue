/**
 * ML Confidence Scoring Worker
 * 
 * Computes confidence scores for attributes and entities
 * Uses a simple ML-style scoring model to assess data reliability
 */

import { Worker, WorkerInput, WorkerOutput } from './workerOrchestrator';
import { logger } from '../../logger';

// Configuration constants
const BASELINE_ATTRIBUTE_COUNT = 10; // Expected number of attributes for a complete profile

export interface AttributeScore {
  attribute: string;
  value: any;
  confidence: number;
  factors: {
    sourceQuality: number;
    dataCompleteness: number;
    crossValidation: number;
    freshness: number;
  };
  sources: string[];
}

export interface EntityConfidenceScore {
  entityId: string;
  overallConfidence: number;
  attributes: AttributeScore[];
  riskFactors: string[];
  qualityMetrics: {
    dataRichness: number;
    sourceReliability: number;
    consistencyScore: number;
  };
}

/**
 * Source reliability scores (can be tuned based on experience)
 */
const SOURCE_RELIABILITY: Record<string, number> = {
  'public_records': 0.9,
  'government_database': 0.95,
  'court_records': 0.9,
  'professional_network': 0.75,
  'social_media': 0.6,
  'news_article': 0.7,
  'web_search': 0.5,
  'user_submitted': 0.4,
  'unknown': 0.3,
};

/**
 * ML Confidence Scoring Worker
 */
export class MLConfidenceScoringWorker implements Worker {
  name = 'ml_confidence_scoring_worker';

  async process(input: WorkerInput): Promise<WorkerOutput> {
    if (!input.entities || !Array.isArray(input.entities)) {
      return {
        success: false,
        error: 'No entities provided for confidence scoring',
      };
    }

    try {
      const scores = await this.scoreEntities(input.entities, input.metadata);

      return {
        success: true,
        data: scores,
        confidence: this.calculateAverageConfidence(scores),
      };
    } catch (error) {
      logger.error('[ML Confidence Scoring Worker] Processing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Test basic scoring
      const testEntity = {
        id: 'test',
        name: 'Test Entity',
        attributes: [
          { name: 'email', value: 'test@example.com', source: 'public_records' }
        ]
      };
      const scores = await this.scoreEntities([testEntity]);
      return scores.length > 0;
    } catch (error) {
      logger.error('[ML Confidence Scoring Worker] Health check failed:', error);
      return false;
    }
  }

  /**
   * Score multiple entities
   */
  private async scoreEntities(
    entities: any[],
    metadata?: Record<string, any>
  ): Promise<EntityConfidenceScore[]> {
    return entities.map(entity => this.scoreEntity(entity, metadata));
  }

  /**
   * Score a single entity
   */
  private scoreEntity(
    entity: any,
    metadata?: Record<string, any>
  ): EntityConfidenceScore {
    const attributeScores: AttributeScore[] = [];
    const riskFactors: string[] = [];

    // Score each attribute
    if (entity.attributes && Array.isArray(entity.attributes)) {
      entity.attributes.forEach((attr: any) => {
        const score = this.scoreAttribute(attr, entity);
        attributeScores.push(score);

        // Check for risk factors
        if (score.confidence < 50) {
          riskFactors.push(`Low confidence in ${attr.name}`);
        }
      });
    } else {
      // Score entity fields directly
      Object.entries(entity).forEach(([key, value]) => {
        if (this.isDataAttribute(key)) {
          const score = this.scoreAttribute(
            { name: key, value, source: entity.source || 'unknown' },
            entity
          );
          attributeScores.push(score);

          if (score.confidence < 50) {
            riskFactors.push(`Low confidence in ${key}`);
          }
        }
      });
    }

    // Calculate quality metrics
    const qualityMetrics = this.calculateQualityMetrics(entity, attributeScores);

    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence(attributeScores, qualityMetrics);

    // Add risk factors based on quality metrics
    if (qualityMetrics.dataRichness < 0.4) {
      riskFactors.push('Limited data available');
    }
    if (qualityMetrics.sourceReliability < 0.5) {
      riskFactors.push('Questionable source reliability');
    }
    if (qualityMetrics.consistencyScore < 0.6) {
      riskFactors.push('Inconsistent data across sources');
    }

    return {
      entityId: entity.id || entity.primaryId || 'unknown',
      overallConfidence,
      attributes: attributeScores,
      riskFactors,
      qualityMetrics,
    };
  }

  /**
   * Score a single attribute
   */
  private scoreAttribute(attr: any, entity: any): AttributeScore {
    // Initialize factors
    const factors = {
      sourceQuality: 0,
      dataCompleteness: 0,
      crossValidation: 0,
      freshness: 0,
    };

    // Source quality (40% weight)
    const source = attr.source || entity.source || 'unknown';
    factors.sourceQuality = this.getSourceReliability(source);

    // Data completeness (25% weight)
    factors.dataCompleteness = this.assessDataCompleteness(attr);

    // Cross-validation (25% weight)
    factors.crossValidation = this.assessCrossValidation(attr, entity);

    // Freshness (10% weight)
    factors.freshness = this.assessFreshness(attr, entity);

    // Calculate weighted confidence
    const confidence = Math.round(
      factors.sourceQuality * 0.4 +
      factors.dataCompleteness * 0.25 +
      factors.crossValidation * 0.25 +
      factors.freshness * 0.1
    );

    return {
      attribute: attr.name,
      value: attr.value,
      confidence,
      factors: {
        sourceQuality: Math.round(factors.sourceQuality),
        dataCompleteness: Math.round(factors.dataCompleteness),
        crossValidation: Math.round(factors.crossValidation),
        freshness: Math.round(factors.freshness),
      },
      sources: [source],
    };
  }

  /**
   * Get source reliability score
   */
  private getSourceReliability(source: string): number {
    const normalizedSource = source.toLowerCase().replace(/\s+/g, '_');
    
    // Try exact match
    if (SOURCE_RELIABILITY[normalizedSource]) {
      return SOURCE_RELIABILITY[normalizedSource] * 100;
    }

    // Try partial match
    for (const [key, value] of Object.entries(SOURCE_RELIABILITY)) {
      if (normalizedSource.includes(key) || key.includes(normalizedSource)) {
        return value * 100;
      }
    }

    return SOURCE_RELIABILITY.unknown * 100;
  }

  /**
   * Assess data completeness
   */
  private assessDataCompleteness(attr: any): number {
    if (!attr.value) return 0;

    const value = String(attr.value);
    
    // Check if value is meaningful (not just placeholder)
    if (value.length < 2) return 30;
    if (value.toLowerCase().includes('unknown') || 
        value.toLowerCase().includes('n/a') ||
        value.toLowerCase().includes('not available')) {
      return 20;
    }

    // Score based on data type and completeness
    switch (attr.name?.toLowerCase()) {
      case 'email':
        return value.includes('@') && value.includes('.') ? 100 : 50;
      case 'phone':
        const digits = value.replace(/\D/g, '');
        return digits.length >= 10 ? 100 : 60;
      case 'name':
        const parts = value.trim().split(/\s+/);
        return parts.length >= 2 ? 100 : 70;
      case 'address':
      case 'location':
        return value.length > 10 ? 90 : 60;
      default:
        return value.length > 5 ? 80 : 60;
    }
  }

  /**
   * Assess cross-validation (multiple sources confirming same data)
   */
  private assessCrossValidation(attr: any, entity: any): number {
    // Check if entity has sources array
    const sources = entity.sources || [];
    
    if (sources.length === 0) return 50; // Single source, medium confidence
    if (sources.length === 1) return 60;
    if (sources.length === 2) return 75;
    if (sources.length >= 3) return 90;

    return 50;
  }

  /**
   * Assess data freshness
   */
  private assessFreshness(attr: any, entity: any): number {
    const timestamp = attr.timestamp || entity.lastUpdated || entity.timestamp;
    
    if (!timestamp) return 50; // Unknown age, medium confidence

    try {
      const date = new Date(timestamp);
      const ageInDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

      if (ageInDays < 30) return 100;      // Less than 1 month old
      if (ageInDays < 90) return 90;       // Less than 3 months old
      if (ageInDays < 180) return 75;      // Less than 6 months old
      if (ageInDays < 365) return 60;      // Less than 1 year old
      if (ageInDays < 730) return 40;      // Less than 2 years old
      return 20;                            // More than 2 years old
    } catch {
      return 50; // Invalid date, medium confidence
    }
  }

  /**
   * Calculate quality metrics for an entity
   */
  private calculateQualityMetrics(
    entity: any,
    attributeScores: AttributeScore[]
  ): {
    dataRichness: number;
    sourceReliability: number;
    consistencyScore: number;
  } {
    // Data richness: how many attributes do we have?
    const actualAttributes = attributeScores.length;
    const dataRichness = Math.min(actualAttributes / BASELINE_ATTRIBUTE_COUNT, 1);

    // Source reliability: average of source quality factors
    const avgSourceQuality = attributeScores.length > 0
      ? attributeScores.reduce((sum, s) => sum + s.factors.sourceQuality, 0) / attributeScores.length
      : 0;
    const sourceReliability = avgSourceQuality / 100;

    // Consistency: how consistent are the confidence scores?
    const confidences = attributeScores.map(s => s.confidence);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 0;
    
    // Calculate variance
    const variance = confidences.length > 1
      ? confidences.reduce((sum, c) => sum + Math.pow(c - avgConfidence, 2), 0) / confidences.length
      : 0;
    
    // Lower variance = higher consistency
    const consistencyScore = variance > 0 ? Math.max(0, 1 - (variance / 1000)) : 1;

    return {
      dataRichness,
      sourceReliability,
      consistencyScore,
    };
  }

  /**
   * Calculate overall confidence for an entity
   */
  private calculateOverallConfidence(
    attributeScores: AttributeScore[],
    qualityMetrics: any
  ): number {
    if (attributeScores.length === 0) return 0;

    // Average attribute confidence (50% weight)
    const avgAttributeConfidence = 
      attributeScores.reduce((sum, s) => sum + s.confidence, 0) / attributeScores.length;

    // Quality metrics (50% weight)
    const qualityScore = (
      qualityMetrics.dataRichness * 0.3 +
      qualityMetrics.sourceReliability * 0.4 +
      qualityMetrics.consistencyScore * 0.3
    ) * 100;

    return Math.round(avgAttributeConfidence * 0.5 + qualityScore * 0.5);
  }

  /**
   * Calculate average confidence across all entities
   */
  private calculateAverageConfidence(scores: EntityConfidenceScore[]): number {
    if (scores.length === 0) return 0;

    const total = scores.reduce((sum, s) => sum + s.overallConfidence, 0);
    return total / scores.length;
  }

  /**
   * Check if a key represents a data attribute
   */
  private isDataAttribute(key: string): boolean {
    const excludedKeys = ['id', 'primaryId', 'entityId', 'source', 'sources', 
                          'confidence', 'metadata', 'timestamp', 'lastUpdated',
                          'records', 'matchScore', 'clusterId', 'clusterType'];
    return !excludedKeys.includes(key);
  }
}

// Singleton instance
export const mlConfidenceScoringWorker = new MLConfidenceScoringWorker();
