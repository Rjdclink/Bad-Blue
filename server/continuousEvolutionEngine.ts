/**
 * Continuous Evolution Engine - Stage 6B Implementation
 * Performance tracking, quality metrics, and self-improvement system
 * 
 * Monitors consultation outcomes, tracks metrics, and enables system evolution.
 */

import { createLogger } from './logger';

const log = createLogger('EvolutionEngine');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ConsultationOutcome {
  id: string;
  sessionId?: string;
  lawType: string;
  state: string;
  timestamp: Date;
  
  // Input metrics
  situationLength: number;
  complexityLevel: 'low' | 'medium' | 'high';
  
  // Process metrics
  processingTime: number; // milliseconds
  modelsUsed: string[];
  tokenUsage: number;
  
  // Output metrics
  causesIdentified: number;
  missingElementsFound: number;
  nextStepsGenerated: number;
  questionsGenerated: number;
  
  // Quality indicators
  verified: boolean;
  verificationScore?: number;
  consensusReached: boolean;
  confidenceLevel: number; // 0-1
  
  // User feedback (when available)
  userSatisfaction?: 1 | 2 | 3 | 4 | 5; // 1=poor, 5=excellent
  userResolution?: 'resolved' | 'partially-resolved' | 'not-resolved' | 'unknown';
  followUpCreated?: boolean;
}

export interface DocumentOutcome {
  id: string;
  documentType: string;
  lawType: string;
  state: string;
  timestamp: Date;
  
  // Process metrics
  processingTime: number;
  wordCount: number;
  pageEstimate: number;
  citationsCount: number;
  
  // Quality indicators
  verified: boolean;
  verificationScore?: number;
  admissibilityRating?: 'admissible' | 'likely-admissible' | 'questionable' | 'inadmissible';
  
  // User feedback
  userAccepted?: boolean;
  revisionsRequested?: number;
}

export interface EvidenceOutcome {
  id: string;
  fileType: string;
  lawType: string;
  state: string;
  timestamp: Date;
  
  // Process metrics
  processingTime: number;
  factsExtracted: number;
  
  // Quality indicators
  strengthRating: 'compelling' | 'strong' | 'moderate' | 'weak' | 'insufficient';
  credibilityScore: number; // 0-100
  reliabilityScore: number; // 0-100
  admissibilityRating: 'admissible' | 'likely-admissible' | 'questionable' | 'inadmissible';
  
  // User feedback
  userAccuracyRating?: 1 | 2 | 3 | 4 | 5;
}

export interface PerformanceMetrics {
  period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  startDate: Date;
  endDate: Date;
  
  // Volume metrics
  totalConsultations: number;
  totalDocuments: number;
  totalEvidenceAnalyses: number;
  
  // Quality metrics
  averageConsultationConfidence: number;
  averageDocumentVerificationScore: number;
  averageEvidenceCredibility: number;
  
  // Performance metrics
  averageConsultationTime: number;
  averageDocumentTime: number;
  averageEvidenceTime: number;
  
  // User satisfaction
  averageUserSatisfaction?: number;
  resolutionRate?: number; // Percentage resolved or partially resolved
  
  // Model performance
  modelUsageDistribution: Record<string, number>;
  consensusRate: number; // Percentage where consensus was reached
  
  // Success indicators
  topPerformingLawTypes: Array<{ lawType: string; successRate: number }>;
  underperformingLawTypes: Array<{ lawType: string; successRate: number }>;
}

export interface QualityAlert {
  id: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'accuracy' | 'performance' | 'user-satisfaction' | 'model-failure';
  description: string;
  metrics: Record<string, number>;
  recommendation: string;
}

export interface ImprovementSuggestion {
  id: string;
  timestamp: Date;
  category: 'model-selection' | 'prompt-engineering' | 'knowledge-update' | 'feature-enhancement';
  priority: 'low' | 'medium' | 'high';
  description: string;
  expectedImpact: string;
  implementation: string;
}

// ============================================================================
// IN-MEMORY STORAGE (Production would use database)
// ============================================================================

const consultationOutcomes: ConsultationOutcome[] = [];
const documentOutcomes: DocumentOutcome[] = [];
const evidenceOutcomes: EvidenceOutcome[] = [];
const qualityAlerts: QualityAlert[] = [];
const improvementSuggestions: ImprovementSuggestion[] = [];

// Limits for in-memory storage
const MAX_STORED_OUTCOMES = 10000;

// ============================================================================
// OUTCOME TRACKING
// ============================================================================

/**
 * Record a consultation outcome
 */
export function recordConsultationOutcome(outcome: ConsultationOutcome): void {
  consultationOutcomes.push(outcome);
  
  // Trim if exceeds limit
  if (consultationOutcomes.length > MAX_STORED_OUTCOMES) {
    consultationOutcomes.shift();
  }
  
  log.info('Consultation outcome recorded', {
    id: outcome.id,
    lawType: outcome.lawType,
    confidence: outcome.confidenceLevel,
    causesIdentified: outcome.causesIdentified
  });
  
  // Analyze for quality alerts
  analyzeConsultationQuality(outcome);
}

/**
 * Record a document generation outcome
 */
export function recordDocumentOutcome(outcome: DocumentOutcome): void {
  documentOutcomes.push(outcome);
  
  if (documentOutcomes.length > MAX_STORED_OUTCOMES) {
    documentOutcomes.shift();
  }
  
  log.info('Document outcome recorded', {
    id: outcome.id,
    documentType: outcome.documentType,
    verified: outcome.verified
  });
  
  analyzeDocumentQuality(outcome);
}

/**
 * Record an evidence analysis outcome
 */
export function recordEvidenceOutcome(outcome: EvidenceOutcome): void {
  evidenceOutcomes.push(outcome);
  
  if (evidenceOutcomes.length > MAX_STORED_OUTCOMES) {
    evidenceOutcomes.shift();
  }
  
  log.info('Evidence outcome recorded', {
    id: outcome.id,
    strengthRating: outcome.strengthRating,
    credibilityScore: outcome.credibilityScore
  });
  
  analyzeEvidenceQuality(outcome);
}

// ============================================================================
// QUALITY ANALYSIS
// ============================================================================

/**
 * Analyze consultation quality and generate alerts if needed
 */
function analyzeConsultationQuality(outcome: ConsultationOutcome): void {
  // Low confidence alert
  if (outcome.confidenceLevel < 0.5) {
    createQualityAlert({
      severity: 'medium',
      category: 'accuracy',
      description: `Low confidence consultation for ${outcome.lawType} in ${outcome.state}`,
      metrics: {
        confidence: outcome.confidenceLevel,
        causesIdentified: outcome.causesIdentified
      },
      recommendation: 'Review model selection for this law type and state combination'
    });
  }
  
  // No causes identified alert
  if (outcome.causesIdentified === 0 && outcome.situationLength > 100) {
    createQualityAlert({
      severity: 'high',
      category: 'accuracy',
      description: `No causes of action identified despite detailed situation (${outcome.lawType})`,
      metrics: {
        situationLength: outcome.situationLength,
        causesIdentified: 0
      },
      recommendation: 'Review legal issue identification logic for this law type'
    });
  }
  
  // Slow processing alert
  if (outcome.processingTime > 60000) { // 60 seconds
    createQualityAlert({
      severity: 'medium',
      category: 'performance',
      description: `Slow consultation processing (${outcome.processingTime}ms)`,
      metrics: {
        processingTime: outcome.processingTime,
        modelsUsed: outcome.modelsUsed.length
      },
      recommendation: 'Consider optimizing model selection or token limits'
    });
  }
}

/**
 * Analyze document quality
 */
function analyzeDocumentQuality(outcome: DocumentOutcome): void {
  // Low verification score alert
  if (outcome.verified && outcome.verificationScore && outcome.verificationScore < 70) {
    createQualityAlert({
      severity: 'high',
      category: 'accuracy',
      description: `Low verification score for ${outcome.documentType} (${outcome.verificationScore})`,
      metrics: {
        verificationScore: outcome.verificationScore,
        citationsCount: outcome.citationsCount
      },
      recommendation: 'Review citation accuracy and legal reasoning for this document type'
    });
  }
  
  // Multiple revisions alert
  if (outcome.revisionsRequested && outcome.revisionsRequested > 3) {
    createQualityAlert({
      severity: 'medium',
      category: 'user-satisfaction',
      description: `Multiple revisions requested for ${outcome.documentType} (${outcome.revisionsRequested})`,
      metrics: {
        revisionsRequested: outcome.revisionsRequested
      },
      recommendation: 'Improve initial document quality or provide better customization options'
    });
  }
}

/**
 * Analyze evidence quality
 */
function analyzeEvidenceQuality(outcome: EvidenceOutcome): void {
  // Low credibility alert
  if (outcome.credibilityScore < 50) {
    createQualityAlert({
      severity: 'medium',
      category: 'accuracy',
      description: `Low credibility score for evidence analysis (${outcome.credibilityScore})`,
      metrics: {
        credibilityScore: outcome.credibilityScore,
        reliabilityScore: outcome.reliabilityScore
      },
      recommendation: 'Review evidence extraction and classification logic'
    });
  }
}

/**
 * Create a quality alert
 */
function createQualityAlert(alert: Omit<QualityAlert, 'id' | 'timestamp'>): void {
  const newAlert: QualityAlert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date(),
    ...alert
  };
  
  qualityAlerts.push(newAlert);
  
  if (qualityAlerts.length > 1000) {
    qualityAlerts.shift();
  }
  
  if (alert.severity === 'high' || alert.severity === 'critical') {
    log.warn('Quality alert created', { alert: newAlert });
  }
}

// ============================================================================
// PERFORMANCE METRICS
// ============================================================================

/**
 * Calculate performance metrics for a time period
 */
export function calculatePerformanceMetrics(
  period: 'hourly' | 'daily' | 'weekly' | 'monthly',
  date?: Date
): PerformanceMetrics {
  const endDate = date || new Date();
  const startDate = calculateStartDate(endDate, period);
  
  // Filter outcomes by date range
  const consultations = consultationOutcomes.filter(o => 
    o.timestamp >= startDate && o.timestamp <= endDate
  );
  const documents = documentOutcomes.filter(o => 
    o.timestamp >= startDate && o.timestamp <= endDate
  );
  const evidence = evidenceOutcomes.filter(o => 
    o.timestamp >= startDate && o.timestamp <= endDate
  );
  
  // Calculate averages
  const avgConsultationConfidence = consultations.length > 0
    ? consultations.reduce((sum, o) => sum + o.confidenceLevel, 0) / consultations.length
    : 0;
    
  const avgDocumentVerification = documents.filter(d => d.verificationScore).length > 0
    ? documents.reduce((sum, o) => sum + (o.verificationScore || 0), 0) / 
      documents.filter(d => d.verificationScore).length
    : 0;
    
  const avgEvidenceCredibility = evidence.length > 0
    ? evidence.reduce((sum, o) => sum + o.credibilityScore, 0) / evidence.length
    : 0;
    
  const avgConsultationTime = consultations.length > 0
    ? consultations.reduce((sum, o) => sum + o.processingTime, 0) / consultations.length
    : 0;
    
  const avgDocumentTime = documents.length > 0
    ? documents.reduce((sum, o) => sum + o.processingTime, 0) / documents.length
    : 0;
    
  const avgEvidenceTime = evidence.length > 0
    ? evidence.reduce((sum, o) => sum + o.processingTime, 0) / evidence.length
    : 0;
  
  // User satisfaction
  const satisfactionRatings = consultations.filter(c => c.userSatisfaction);
  const avgUserSatisfaction = satisfactionRatings.length > 0
    ? satisfactionRatings.reduce((sum, o) => sum + (o.userSatisfaction || 0), 0) / satisfactionRatings.length
    : undefined;
  
  // Resolution rate
  const withResolution = consultations.filter(c => c.userResolution);
  const resolved = withResolution.filter(c => 
    c.userResolution === 'resolved' || c.userResolution === 'partially-resolved'
  ).length;
  const resolutionRate = withResolution.length > 0
    ? (resolved / withResolution.length) * 100
    : undefined;
  
  // Model usage distribution
  const modelUsage = new Map<string, number>();
  consultations.forEach(c => {
    c.modelsUsed.forEach(model => {
      modelUsage.set(model, (modelUsage.get(model) || 0) + 1);
    });
  });
  const modelUsageDistribution: Record<string, number> = {};
  modelUsage.forEach((count, model) => {
    modelUsageDistribution[model] = count;
  });
  
  // Consensus rate
  const withConsensus = consultations.filter(c => c.consensusReached).length;
  const consensusRate = consultations.length > 0
    ? (withConsensus / consultations.length) * 100
    : 0;
  
  // Law type performance
  const lawTypePerformance = calculateLawTypePerformance(consultations);
  
  return {
    period,
    startDate,
    endDate,
    totalConsultations: consultations.length,
    totalDocuments: documents.length,
    totalEvidenceAnalyses: evidence.length,
    averageConsultationConfidence: avgConsultationConfidence,
    averageDocumentVerificationScore: avgDocumentVerification,
    averageEvidenceCredibility: avgEvidenceCredibility,
    averageConsultationTime: avgConsultationTime,
    averageDocumentTime: avgDocumentTime,
    averageEvidenceTime: avgEvidenceTime,
    averageUserSatisfaction: avgUserSatisfaction,
    resolutionRate,
    modelUsageDistribution,
    consensusRate,
    topPerformingLawTypes: lawTypePerformance.top,
    underperformingLawTypes: lawTypePerformance.underperforming
  };
}

/**
 * Calculate start date based on period
 */
function calculateStartDate(endDate: Date, period: 'hourly' | 'daily' | 'weekly' | 'monthly'): Date {
  const start = new Date(endDate);
  
  switch (period) {
    case 'hourly':
      start.setHours(start.getHours() - 1);
      break;
    case 'daily':
      start.setDate(start.getDate() - 1);
      break;
    case 'weekly':
      start.setDate(start.getDate() - 7);
      break;
    case 'monthly':
      start.setMonth(start.getMonth() - 1);
      break;
  }
  
  return start;
}

/**
 * Calculate law type performance
 */
function calculateLawTypePerformance(consultations: ConsultationOutcome[]): {
  top: Array<{ lawType: string; successRate: number }>;
  underperforming: Array<{ lawType: string; successRate: number }>;
} {
  const lawTypeStats = new Map<string, { total: number; successful: number }>();
  
  consultations.forEach(c => {
    const stats = lawTypeStats.get(c.lawType) || { total: 0, successful: 0 };
    stats.total++;
    
    // Consider successful if high confidence and causes identified
    if (c.confidenceLevel >= 0.7 && c.causesIdentified > 0) {
      stats.successful++;
    }
    
    lawTypeStats.set(c.lawType, stats);
  });
  
  const lawTypePerformance = Array.from(lawTypeStats.entries())
    .map(([lawType, stats]) => ({
      lawType,
      successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0
    }))
    .sort((a, b) => b.successRate - a.successRate);
  
  return {
    top: lawTypePerformance.slice(0, 5),
    underperforming: lawTypePerformance.slice(-5).reverse()
  };
}

// ============================================================================
// IMPROVEMENT SUGGESTIONS
// ============================================================================

/**
 * Generate improvement suggestions based on recent performance
 */
export function generateImprovementSuggestions(): ImprovementSuggestion[] {
  const metrics = calculatePerformanceMetrics('weekly');
  const suggestions: Omit<ImprovementSuggestion, 'id' | 'timestamp'>[] = [];
  
  // Low confidence suggestion
  if (metrics.averageConsultationConfidence < 0.7) {
    suggestions.push({
      category: 'model-selection',
      priority: 'high',
      description: 'Average consultation confidence is below target (70%)',
      expectedImpact: 'Improve confidence from ' + Math.round(metrics.averageConsultationConfidence * 100) + '% to 75%+',
      implementation: 'Review and update model selection criteria for low-performing law types'
    });
  }
  
  // Low consensus suggestion
  if (metrics.consensusRate < 80) {
    suggestions.push({
      category: 'model-selection',
      priority: 'medium',
      description: 'Consensus rate is below target (80%)',
      expectedImpact: 'Improve consensus from ' + Math.round(metrics.consensusRate) + '% to 85%+',
      implementation: 'Fine-tune model selection to reduce disagreement on legal analysis'
    });
  }
  
  // Slow processing suggestion
  if (metrics.averageConsultationTime > 30000) {
    suggestions.push({
      category: 'feature-enhancement',
      priority: 'medium',
      description: 'Average consultation time exceeds 30 seconds',
      expectedImpact: 'Reduce processing time by 25-30%',
      implementation: 'Implement caching for common legal patterns and optimize token limits'
    });
  }
  
  // Underperforming law types
  if (metrics.underperformingLawTypes.length > 0) {
    const worst = metrics.underperformingLawTypes[0];
    if (worst.successRate < 60) {
      suggestions.push({
        category: 'knowledge-update',
        priority: 'high',
        description: `${worst.lawType} has low success rate (${Math.round(worst.successRate)}%)`,
        expectedImpact: 'Improve success rate for this law type to 70%+',
        implementation: 'Update legal knowledge base and refine prompts for this specific area'
      });
    }
  }
  
  // Convert to full suggestions
  return suggestions.map(s => ({
    id: `suggestion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date(),
    ...s
  }));
}

// ============================================================================
// API EXPORTS
// ============================================================================

export const EvolutionEngine = {
  recordConsultationOutcome,
  recordDocumentOutcome,
  recordEvidenceOutcome,
  calculatePerformanceMetrics,
  generateImprovementSuggestions,
  
  // Read-only access to outcomes (for analysis)
  getRecentConsultations: (limit = 100) => consultationOutcomes.slice(-limit),
  getRecentDocuments: (limit = 100) => documentOutcomes.slice(-limit),
  getRecentEvidence: (limit = 100) => evidenceOutcomes.slice(-limit),
  getRecentAlerts: (limit = 50) => qualityAlerts.slice(-limit),
  getRecentSuggestions: (limit = 10) => improvementSuggestions.slice(-limit)
};
