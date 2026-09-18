/**
 * ML Routing Worker for Orchestration
 * 
 * Produces advisory capability matches over the canonical Harmony registry.
 * Runtime execution still uses the complete configured Harmony mesh; this
 * worker must never become an alternate model authority.
 */

import { createLogger } from '../../logger';
import {
  HARMONY_17_PARTICIPANTS,
  type HarmonyCapability,
} from '../../aiHarmonyModelRegistry';

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

function hasCapability(
  capabilities: readonly HarmonyCapability[],
  capability: HarmonyCapability,
): boolean {
  return capabilities.includes(capability);
}

/**
 * Compatibility scoring view over the canonical 17-participant Harmony registry.
 *
 * These values are capability-derived heuristics only. They never select a
 * provider as an execution authority; runtime model participation is owned by
 * the Harmony orchestrator.
 */
const MODEL_CAPABILITIES: ModelCapability[] = HARMONY_17_PARTICIPANTS.map(participant => {
  const capabilities = participant.capabilities;
  const legalReasoning =
    hasCapability(capabilities, 'legal-analysis') ? 1
      : hasCapability(capabilities, 'deep-reasoning') ? 0.9
        : hasCapability(capabilities, 'verification') ? 0.82
          : 0.65;
  const factExtraction =
    hasCapability(capabilities, 'structured-output') ? 1
      : hasCapability(capabilities, 'verification') ? 0.92
        : hasCapability(capabilities, 'research') ? 0.86
          : 0.7;
  const documentGeneration =
    hasCapability(capabilities, 'legal-analysis') && hasCapability(capabilities, 'structured-output') ? 1
      : hasCapability(capabilities, 'legal-analysis') ? 0.94
        : hasCapability(capabilities, 'structured-output') ? 0.9
          : 0.72;
  const dataAnalysis =
    hasCapability(capabilities, 'deep-reasoning') ? 0.98
      : hasCapability(capabilities, 'research') ? 0.92
        : hasCapability(capabilities, 'verification') ? 0.88
          : 0.72;
  const speed = hasCapability(capabilities, 'fast-chat') ? 1 : 0.7;

  return {
    modelName: participant.model,
    capabilities: {
      legalReasoning,
      factExtraction,
      documentGeneration,
      dataAnalysis,
      // The registry does not currently assert language coverage, so keep this
      // neutral rather than inventing provider-specific multilingual rankings.
      multilingual: 0.75,
      speed,
      // Cost is governed separately. Keep the routing heuristic neutral so
      // capability, not an invented price ranking, drives this worker.
      costEfficiency: 0.5,
    },
    specializations: [...capabilities],
    averageResponseTime: hasCapability(capabilities, 'fast-chat') ? 750 : 1500,
    successRate: 0.9,
    availability: participant.configured() ? 'available' : 'offline',
  };
});

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
