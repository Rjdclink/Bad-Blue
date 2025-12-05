/**
 * ML Routing Worker for Orchestration
 * 
 * Intelligently routes tasks to the most appropriate models/agents based on:
 * - Task type and complexity
 * - Historical performance data
 * - Model capabilities
 * - Current load and availability
 */

import { createLogger } from '../../logger';

const log = createLogger('MLRoutingWorker');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Task {
  id: string;
  type: 'legal-consultation' | 'document-generation' | 'evidence-analysis' | 
        'osint-research' | 'entity-resolution' | 'nlp-processing' | 'fact-extraction';
  complexity: 'low' | 'medium' | 'high';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  requirements?: {
    needsLegalExpertise?: boolean;
    needsFactChecking?: boolean;
    needsCreativeWriting?: boolean;
    needsDataAnalysis?: boolean;
    needsMultilingual?: boolean;
  };
  context?: string;
}

export interface ModelCapability {
  modelName: string;
  capabilities: {
    legalReasoning: number; // 0-1
    factExtraction: number; // 0-1
    documentGeneration: number; // 0-1
    dataAnalysis: number; // 0-1
    multilingual: number; // 0-1
    speed: number; // 0-1 (higher is faster)
    costEfficiency: number; // 0-1 (higher is more cost-efficient)
  };
  specializations: string[];
  averageResponseTime: number; // milliseconds
  successRate: number; // 0-1
  availability: 'available' | 'busy' | 'offline';
}

export interface RoutingDecision {
  taskId: string;
  primaryModel: string;
  fallbackModels: string[];
  reasoning: string;
  confidence: number; // 0-1
  estimatedTime: number; // milliseconds
  estimatedCost: number; // relative cost units
  shouldParallelize: boolean;
  parallelModels?: string[];
}

export interface RoutingResult {
  decision: RoutingDecision;
  alternativeRoutes: Array<{
    models: string[];
    reasoning: string;
    score: number;
  }>;
}

// ============================================================================
// MODEL CAPABILITY DEFINITIONS
// ============================================================================

const MODEL_CAPABILITIES: ModelCapability[] = [
  {
    modelName: 'gemini-2.0-flash',
    capabilities: {
      legalReasoning: 0.75,
      factExtraction: 0.90,
      documentGeneration: 0.80,
      dataAnalysis: 0.85,
      multilingual: 0.85,
      speed: 0.95,
      costEfficiency: 0.90
    },
    specializations: ['fact-extraction', 'data-analysis', 'fast-processing'],
    averageResponseTime: 800,
    successRate: 0.88,
    availability: 'available'
  },
  {
    modelName: 'claude-3-5-sonnet',
    capabilities: {
      legalReasoning: 0.95,
      factExtraction: 0.85,
      documentGeneration: 0.95,
      dataAnalysis: 0.85,
      multilingual: 0.80,
      speed: 0.70,
      costEfficiency: 0.50
    },
    specializations: ['legal-reasoning', 'document-generation', 'complex-analysis'],
    averageResponseTime: 2000,
    successRate: 0.95,
    availability: 'available'
  },
  {
    modelName: 'groq-llama-3.3-70b',
    capabilities: {
      legalReasoning: 0.85,
      factExtraction: 0.80,
      documentGeneration: 0.75,
      dataAnalysis: 0.85,
      multilingual: 0.75,
      speed: 0.98,
      costEfficiency: 0.95
    },
    specializations: ['fast-inference', 'legal-research', 'real-time-processing'],
    averageResponseTime: 500,
    successRate: 0.87,
    availability: 'available'
  },
  {
    modelName: 'mistral-small',
    capabilities: {
      legalReasoning: 0.70,
      factExtraction: 0.75,
      documentGeneration: 0.80,
      dataAnalysis: 0.70,
      multilingual: 0.85,
      speed: 0.90,
      costEfficiency: 0.95
    },
    specializations: ['document-generation', 'summarization', 'cost-effective'],
    averageResponseTime: 1000,
    successRate: 0.82,
    availability: 'available'
  }
];

// ============================================================================
// ROUTING LOGIC FUNCTIONS
// ============================================================================

/**
 * Calculate match score between task and model
 */
function calculateMatchScore(task: Task, model: ModelCapability): number {
  let score = 0;
  let weights = 0;

  // Task type matching
  switch (task.type) {
    case 'legal-consultation':
      score += model.capabilities.legalReasoning * 0.5;
      weights += 0.5;
      break;
    case 'document-generation':
      score += model.capabilities.documentGeneration * 0.5;
      weights += 0.5;
      break;
    case 'evidence-analysis':
      score += model.capabilities.legalReasoning * 0.3 + model.capabilities.dataAnalysis * 0.2;
      weights += 0.5;
      break;
    case 'osint-research':
      score += model.capabilities.dataAnalysis * 0.5;
      weights += 0.5;
      break;
    case 'entity-resolution':
      score += model.capabilities.dataAnalysis * 0.3 + model.capabilities.factExtraction * 0.2;
      weights += 0.5;
      break;
    case 'nlp-processing':
      score += model.capabilities.factExtraction * 0.5;
      weights += 0.5;
      break;
    case 'fact-extraction':
      score += model.capabilities.factExtraction * 0.5;
      weights += 0.5;
      break;
  }

  // Complexity considerations
  if (task.complexity === 'high') {
    score += model.capabilities.legalReasoning * 0.2;
    weights += 0.2;
  } else if (task.complexity === 'low') {
    score += model.capabilities.speed * 0.2;
    weights += 0.2;
  }

  // Priority considerations
  if (task.priority === 'urgent') {
    score += model.capabilities.speed * 0.2;
    weights += 0.2;
  } else if (task.priority === 'low') {
    score += model.capabilities.costEfficiency * 0.2;
    weights += 0.2;
  }

  // Requirements matching
  if (task.requirements) {
    if (task.requirements.needsLegalExpertise) {
      score += model.capabilities.legalReasoning * 0.1;
      weights += 0.1;
    }
    if (task.requirements.needsFactChecking) {
      score += model.capabilities.factExtraction * 0.1;
      weights += 0.1;
    }
    if (task.requirements.needsCreativeWriting) {
      score += model.capabilities.documentGeneration * 0.1;
      weights += 0.1;
    }
    if (task.requirements.needsDataAnalysis) {
      score += model.capabilities.dataAnalysis * 0.1;
      weights += 0.1;
    }
    if (task.requirements.needsMultilingual) {
      score += model.capabilities.multilingual * 0.1;
      weights += 0.1;
    }
  }

  // Success rate factor
  score += model.successRate * 0.1;
  weights += 0.1;

  // Availability penalty
  if (model.availability === 'busy') {
    score *= 0.8;
  } else if (model.availability === 'offline') {
    score = 0;
  }

  return weights > 0 ? score / weights : 0;
}

/**
 * Determine if task should be parallelized across multiple models
 */
function shouldParallelizeTask(task: Task): boolean {
  // Parallelize high-priority and high-complexity tasks
  if (task.priority === 'urgent' && task.complexity === 'high') {
    return true;
  }

  // Parallelize legal consultations and evidence analysis for better accuracy
  if (task.type === 'legal-consultation' || task.type === 'evidence-analysis') {
    return true;
  }

  return false;
}

/**
 * Select models for parallel execution
 */
function selectParallelModels(task: Task, modelScores: Array<{ model: ModelCapability; score: number }>): string[] {
  // Take top 2-3 models with scores above threshold
  const threshold = 0.7;
  const topModels = modelScores
    .filter(ms => ms.score >= threshold)
    .slice(0, 3)
    .map(ms => ms.model.modelName);

  return topModels.length >= 2 ? topModels : [];
}

/**
 * Estimate task completion time
 */
function estimateTime(model: ModelCapability, task: Task): number {
  let baseTime = model.averageResponseTime;

  // Adjust for complexity
  if (task.complexity === 'high') {
    baseTime *= 2;
  } else if (task.complexity === 'low') {
    baseTime *= 0.7;
  }

  return Math.round(baseTime);
}

/**
 * Estimate relative cost
 */
function estimateCost(model: ModelCapability, task: Task): number {
  let baseCost = 1 - model.capabilities.costEfficiency;

  // Adjust for complexity
  if (task.complexity === 'high') {
    baseCost *= 1.5;
  } else if (task.complexity === 'low') {
    baseCost *= 0.7;
  }

  return baseCost;
}

// ============================================================================
// MAIN WORKER FUNCTIONS
// ============================================================================

/**
 * Route a task to the most appropriate model(s)
 */
export async function routeTask(task: Task): Promise<RoutingResult> {
  log.info('Routing task', { taskId: task.id, type: task.type, complexity: task.complexity });

  // Calculate match scores for all available models
  const modelScores = MODEL_CAPABILITIES
    .map(model => ({
      model,
      score: calculateMatchScore(task, model)
    }))
    .sort((a, b) => b.score - a.score);

  if (modelScores.length === 0 || modelScores[0].score === 0) {
    throw new Error('No suitable models available for task');
  }

  const primaryModel = modelScores[0].model;
  const fallbackModels = modelScores.slice(1, 3).map(ms => ms.model.modelName);

  // Determine if task should be parallelized
  const parallelize = shouldParallelizeTask(task);
  const parallelModels = parallelize ? selectParallelModels(task, modelScores) : undefined;

  // Estimate time and cost
  const estimatedTime = estimateTime(primaryModel, task);
  const estimatedCost = estimateCost(primaryModel, task);

  // Generate reasoning
  const reasoning = generateRoutingReasoning(task, primaryModel, modelScores[0].score, parallelize);

  const decision: RoutingDecision = {
    taskId: task.id,
    primaryModel: primaryModel.modelName,
    fallbackModels,
    reasoning,
    confidence: modelScores[0].score,
    estimatedTime,
    estimatedCost,
    shouldParallelize: parallelize,
    parallelModels
  };

  // Generate alternative routes
  const alternativeRoutes = modelScores.slice(1, 4).map(ms => ({
    models: [ms.model.modelName],
    reasoning: `Alternative: ${ms.model.modelName} (score: ${(ms.score * 100).toFixed(1)}%)`,
    score: ms.score
  }));

  log.info('Routing decision made', {
    taskId: task.id,
    primaryModel: decision.primaryModel,
    confidence: decision.confidence.toFixed(3),
    parallelize
  });

  return {
    decision,
    alternativeRoutes
  };
}

/**
 * Generate human-readable routing reasoning
 */
function generateRoutingReasoning(
  task: Task,
  model: ModelCapability,
  score: number,
  parallelize: boolean
): string {
  let reasoning = `Selected ${model.modelName} (confidence: ${(score * 100).toFixed(1)}%) based on `;

  const reasons: string[] = [];

  // Add capability reasons
  if (task.type === 'legal-consultation' && model.capabilities.legalReasoning > 0.8) {
    reasons.push('strong legal reasoning capability');
  }
  if (task.type === 'document-generation' && model.capabilities.documentGeneration > 0.8) {
    reasons.push('excellent document generation');
  }
  if (task.complexity === 'high' && model.capabilities.legalReasoning > 0.8) {
    reasons.push('ability to handle complex tasks');
  }
  if (task.priority === 'urgent' && model.capabilities.speed > 0.9) {
    reasons.push('fast response time');
  }

  // Add specializations
  const matchingSpecs = model.specializations.filter(spec => 
    task.type.includes(spec) || task.context?.toLowerCase().includes(spec)
  );
  if (matchingSpecs.length > 0) {
    reasons.push(`specialization in ${matchingSpecs.join(', ')}`);
  }

  reasoning += reasons.slice(0, 3).join(', ');

  if (parallelize) {
    reasoning += '. Task will be parallelized across multiple models for improved accuracy and consensus.';
  }

  return reasoning;
}

/**
 * Batch route multiple tasks efficiently
 */
export async function batchRoute(tasks: Task[]): Promise<Map<string, RoutingResult>> {
  log.info('Batch routing tasks', { count: tasks.length });

  const results = new Map<string, RoutingResult>();

  for (const task of tasks) {
    try {
      const result = await routeTask(task);
      results.set(task.id, result);
    } catch (error) {
      log.error(`Failed to route task ${task.id}`, error);
    }
  }

  log.info('Batch routing complete', { successCount: results.size });

  return results;
}

/**
 * Update model capabilities based on performance feedback
 */
export function updateModelCapabilities(
  modelName: string,
  performance: {
    taskType: Task['type'];
    successRate?: number;
    responseTime?: number;
    availability?: ModelCapability['availability'];
  }
): void {
  const model = MODEL_CAPABILITIES.find(m => m.modelName === modelName);
  
  if (!model) {
    log.warn(`Model ${modelName} not found for capability update`);
    return;
  }

  // Update success rate if provided
  if (performance.successRate !== undefined) {
    model.successRate = (model.successRate * 0.9) + (performance.successRate * 0.1); // Moving average
  }

  // Update response time if provided
  if (performance.responseTime !== undefined) {
    model.averageResponseTime = (model.averageResponseTime * 0.9) + (performance.responseTime * 0.1);
  }

  // Update availability if provided
  if (performance.availability !== undefined) {
    model.availability = performance.availability;
  }

  log.info(`Updated capabilities for ${modelName}`, {
    successRate: model.successRate.toFixed(3),
    avgResponseTime: model.averageResponseTime.toFixed(0)
  });
}

/**
 * Get current model capabilities (for monitoring/debugging)
 */
export function getModelCapabilities(): ModelCapability[] {
  return MODEL_CAPABILITIES.map(m => ({ ...m })); // Return copies
}

/**
 * Health check for routing worker
 */
export async function healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
  try {
    // Test routing with sample task
    const testTask: Task = {
      id: 'test-task',
      type: 'legal-consultation',
      complexity: 'medium',
      priority: 'normal'
    };

    const result = await routeTask(testTask);

    if (result.decision.primaryModel && result.decision.confidence > 0) {
      return { status: 'healthy', message: 'ML Routing Worker is operational' };
    }

    return { status: 'unhealthy', message: 'Routing produced invalid results' };
  } catch (error) {
    log.error('Health check failed', error);
    return { status: 'unhealthy', message: `Health check failed: ${error}` };
  }
}
