/**
 * Legal Model Orchestrator - Enhanced with ML Intelligence
 * Enhanced multi-model orchestration specifically for legal tasks
 * 
 * Provides intelligent model selection, result fusion, and consensus building
 * for legal consultation, document generation, and evidence analysis.
 * 
 * Integrates ML workers for:
 * - Confidence scoring and ranking of model outputs
 * - Intelligent task routing to optimal models
 * - Conflict resolution between model opinions
 */

import { generateUserText, TaskPriority, TaskComplexity, UsageContext, type AITaskMetadata } from './aiProvider';
import { createLogger } from './logger';
import {
  analyzeConfidence,
  routeTask,
  type ModelOutput,
  type Task as MLTask
} from './services/mlnlp';

const log = createLogger('LegalModelOrchestrator');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type LegalTaskType = 
  | 'legal-consultation'
  | 'document-generation'
  | 'evidence-analysis'
  | 'legal-research'
  | 'fact-extraction'
  | 'legal-reasoning'
  | 'precedent-search'
  | 'statute-interpretation';

export interface ModelCapability {
  modelName: string;
  strengths: LegalTaskType[];
  weaknesses: LegalTaskType[];
  costRating: 'low' | 'medium' | 'high';
  speedRating: 'fast' | 'medium' | 'slow';
  accuracyRating: number; // 0-100
}

export interface ModelSelection {
  primary: string;
  fallback: string[];
  reasoning: string;
}

export interface ConsensusResult<T> {
  result: T;
  confidence: number; // 0-1
  agreement: number; // 0-1 (percentage of models that agreed)
  modelResults: Array<{
    model: string;
    result: T;
    reasoning?: string;
  }>;
  conflicts: string[];
  recommendation: 'use-result' | 'needs-review' | 'insufficient-consensus';
}

// ============================================================================
// MODEL CAPABILITY MATRIX
// ============================================================================

const MODEL_CAPABILITIES: ModelCapability[] = [
  {
    modelName: 'gemini-2.0-flash',
    strengths: ['fact-extraction', 'evidence-analysis'],
    weaknesses: ['legal-reasoning'],
    costRating: 'low',
    speedRating: 'fast',
    accuracyRating: 85
  },
  {
    modelName: 'claude-3-5-sonnet',
    strengths: ['legal-consultation', 'legal-reasoning', 'document-generation'],
    weaknesses: [],
    costRating: 'high',
    speedRating: 'medium',
    accuracyRating: 95
  },
  {
    modelName: 'groq-llama-3.3-70b',
    strengths: ['legal-research', 'precedent-search', 'statute-interpretation'],
    weaknesses: ['document-generation'],
    costRating: 'low',
    speedRating: 'fast',
    accuracyRating: 88
  },
  {
    modelName: 'mistral-small',
    strengths: ['document-generation', 'fact-extraction'],
    weaknesses: ['legal-reasoning'],
    costRating: 'low',
    speedRating: 'fast',
    accuracyRating: 82
  }
];

// ============================================================================
// MODEL SELECTION ENGINE
// ============================================================================

/**
 * Select optimal models for a legal task
 */
export function selectModelsForTask(
  taskType: LegalTaskType,
  priority: TaskPriority,
  complexity: TaskComplexity
): ModelSelection {
  // Filter models by task type strengths
  const capableModels = MODEL_CAPABILITIES
    .filter(model => model.strengths.includes(taskType))
    .sort((a, b) => b.accuracyRating - a.accuracyRating);

  // If no specific strengths, use all models sorted by accuracy
  const sortedModels = capableModels.length > 0 
    ? capableModels 
    : [...MODEL_CAPABILITIES].sort((a, b) => b.accuracyRating - a.accuracyRating);

  // Select primary based on priority and complexity
  let primary: string;
  let reasoning: string;

  if (priority === TaskPriority.CRITICAL_USER || complexity === TaskComplexity.HIGH) {
    // Use most accurate model for critical/complex tasks
    primary = sortedModels[0].modelName;
    reasoning = `Selected ${primary} for high accuracy on ${taskType} (critical/complex task)`;
  } else if (priority === TaskPriority.LOW_BACKGROUND) {
    // Use fastest, cheapest model for background tasks
    const fastCheapModels = sortedModels.filter(m => m.speedRating === 'fast' && m.costRating === 'low');
    primary = fastCheapModels.length > 0 ? fastCheapModels[0].modelName : sortedModels[0].modelName;
    reasoning = `Selected ${primary} for speed and cost efficiency on ${taskType} (background task)`;
  } else {
    // Balance accuracy, speed, and cost for normal tasks
    primary = sortedModels[0].modelName;
    reasoning = `Selected ${primary} as optimal balance for ${taskType} (standard task)`;
  }

  // Select fallbacks
  const fallback = sortedModels
    .filter(m => m.modelName !== primary)
    .slice(0, 2)
    .map(m => m.modelName);

  return {
    primary,
    fallback,
    reasoning
  };
}

// ============================================================================
// MULTI-MODEL EXECUTION
// ============================================================================

/**
 * Execute task across multiple models for consensus
 */
export async function executeWithConsensus<T>(
  task: AITaskMetadata & { legalTaskType: LegalTaskType },
  prompt: string,
  options: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    useJSON?: boolean;
    modelCount?: number; // Number of models to use (default: 3)
    parseResult?: (content: string) => T;
  } = {}
): Promise<ConsensusResult<T>> {
  const modelCount = options.modelCount || 3;
  
  log.info('Executing task with consensus', { 
    taskType: task.legalTaskType, 
    modelCount 
  });

  // Select models
  const selection = selectModelsForTask(
    task.legalTaskType,
    task.priority,
    task.complexity
  );

  const modelsToUse = [selection.primary, ...selection.fallback].slice(0, modelCount);

  // Execute across all models in parallel
  const modelPromises = modelsToUse.map(async (modelName) => {
    try {
      const response = await generateUserText(
        task,
        prompt,
        {
          ...options,
          model: modelName
        }
      );

      const parsed = options.parseResult 
        ? options.parseResult(response.content)
        : response.content as T;

      return {
        model: modelName,
        result: parsed,
        success: true,
        reasoning: undefined
      };
    } catch (error) {
      log.warn('Model execution failed', { model: modelName, error });
      return {
        model: modelName,
        result: null as T,
        success: false,
        reasoning: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  const results = await Promise.all(modelPromises);
  const successfulResults = results.filter(r => r.success);

  if (successfulResults.length === 0) {
    throw new Error('All models failed to execute task');
  }

  // Analyze consensus
  const consensus = analyzeConsensus(successfulResults);

  log.info('Consensus analysis complete', {
    taskType: task.legalTaskType,
    agreement: consensus.agreement,
    confidence: consensus.confidence,
    recommendation: consensus.recommendation
  });

  return consensus;
}

/**
 * Analyze consensus from multiple model results
 */
function analyzeConsensus<T>(
  results: Array<{ model: string; result: T; success: boolean; reasoning?: string }>
): ConsensusResult<T> {
  const modelResults = results.map(r => ({
    model: r.model,
    result: r.result,
    reasoning: r.reasoning
  }));

  // For string results, check similarity
  if (typeof results[0].result === 'string') {
    const strResults = results.map(r => r.result as string);
    const agreement = calculateStringAgreement(strResults);
    
    // Use longest or most detailed result as primary
    const primaryResult = strResults.reduce((a, b) => a.length > b.length ? a : b);

    return {
      result: primaryResult as T,
      confidence: agreement,
      agreement,
      modelResults,
      conflicts: agreement < 0.7 ? ['Significant variation in model responses'] : [],
      recommendation: agreement >= 0.8 ? 'use-result' : agreement >= 0.6 ? 'needs-review' : 'insufficient-consensus'
    };
  }

  // For JSON objects, check field agreement
  if (typeof results[0].result === 'object' && results[0].result !== null) {
    const objResults = results.map(r => r.result as Record<string, any>);
    const { merged, agreement, conflicts } = mergeObjectResults(objResults);

    return {
      result: merged as T,
      confidence: agreement,
      agreement,
      modelResults,
      conflicts,
      recommendation: agreement >= 0.8 ? 'use-result' : agreement >= 0.6 ? 'needs-review' : 'insufficient-consensus'
    };
  }

  // Default: use first result with moderate confidence
  return {
    result: results[0].result,
    confidence: 0.7,
    agreement: 0.7,
    modelResults,
    conflicts: ['Unable to determine consensus for this result type'],
    recommendation: 'needs-review'
  };
}

/**
 * Calculate agreement between string results
 */
function calculateStringAgreement(results: string[]): number {
  if (results.length < 2) return 1.0;

  let totalSimilarity = 0;
  let comparisons = 0;

  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const similarity = calculateStringSimilarity(results[i], results[j]);
      totalSimilarity += similarity;
      comparisons++;
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0;
}

/**
 * Calculate similarity between two strings (simple word overlap)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Merge object results from multiple models
 */
function mergeObjectResults(
  results: Record<string, any>[]
): { merged: Record<string, any>; agreement: number; conflicts: string[] } {
  if (results.length === 0) {
    return { merged: {}, agreement: 0, conflicts: ['No results to merge'] };
  }

  if (results.length === 1) {
    return { merged: results[0], agreement: 1.0, conflicts: [] };
  }

  const merged: Record<string, any> = {};
  const conflicts: string[] = [];
  let totalFields = 0;
  let agreedFields = 0;

  // Get all unique keys
  const allKeys = new Set<string>();
  results.forEach(obj => Object.keys(obj).forEach(key => allKeys.add(key)));

  // For each key, find consensus value
  allKeys.forEach(key => {
    totalFields++;
    const values = results.map(r => r[key]).filter(v => v !== undefined);

    if (values.length === 0) {
      conflicts.push(`Field '${key}' missing in all results`);
      return;
    }

    // For arrays, merge and deduplicate
    if (Array.isArray(values[0])) {
      const allItems = values.flat();
      merged[key] = [...new Set(allItems.map(item => JSON.stringify(item)))].map(item => JSON.parse(item));
      agreedFields += 0.8; // Partial credit for arrays
      return;
    }

    // For primitives, use majority vote
    const valueCounts = new Map<string, number>();
    values.forEach(v => {
      const key = JSON.stringify(v);
      valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
    });

    const [mostCommon, count] = Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1])[0];

    merged[key] = JSON.parse(mostCommon);

    if (count === values.length) {
      agreedFields++;
    } else {
      agreedFields += count / values.length;
      conflicts.push(`Field '${key}' has ${valueCounts.size} different values (using majority)`);
    }
  });

  const agreement = totalFields > 0 ? agreedFields / totalFields : 0;

  return { merged, agreement, conflicts };
}

// ============================================================================
// TASK-SPECIFIC ORCHESTRATION
// ============================================================================

/**
 * Execute legal consultation with optimal model selection
 */
export async function executeLegalConsultation(
  prompt: string,
  systemPrompt: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    useConsensus?: boolean;
  } = {}
): Promise<string | ConsensusResult<string>> {
  const task: AITaskMetadata & { legalTaskType: LegalTaskType } = {
    taskType: 'legal-consultation',
    legalTaskType: 'legal-consultation',
    context: UsageContext.USER_INITIATED,
    priority: TaskPriority.HIGH_USER,
    complexity: TaskComplexity.HIGH,
    description: 'Legal consultation analysis'
  };

  if (options.useConsensus) {
    return executeWithConsensus<string>(
      task,
      prompt,
      {
        systemPrompt,
        temperature: options.temperature || 0.3,
        maxTokens: options.maxTokens || 3000,
        modelCount: 3,
        parseResult: (content) => content
      }
    );
  }

  const selection = selectModelsForTask(task.legalTaskType, task.priority, task.complexity);
  log.info('Executing legal consultation', { model: selection.primary, reasoning: selection.reasoning });

  const response = await generateUserText(
    task,
    prompt,
    {
      systemPrompt,
      temperature: options.temperature || 0.3,
      maxTokens: options.maxTokens || 3000,
      model: selection.primary
    }
  );

  return response.content;
}

/**
 * Execute document generation with optimal model selection
 */
export async function executeDocumentGeneration(
  prompt: string,
  systemPrompt: string,
  options: {
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const task: AITaskMetadata & { legalTaskType: LegalTaskType } = {
    taskType: 'document-generation',
    legalTaskType: 'document-generation',
    context: UsageContext.USER_INITIATED,
    priority: TaskPriority.HIGH_USER,
    complexity: TaskComplexity.MEDIUM,
    description: 'Legal document generation'
  };

  const selection = selectModelsForTask(task.legalTaskType, task.priority, task.complexity);
  log.info('Executing document generation', { model: selection.primary, reasoning: selection.reasoning });

  const response = await generateUserText(
    task,
    prompt,
    {
      systemPrompt,
      temperature: options.temperature || 0.3,
      maxTokens: options.maxTokens || 4000,
      model: selection.primary
    }
  );

  return response.content;
}

/**
 * Execute evidence analysis with optimal model selection
 */
export async function executeEvidenceAnalysis(
  prompt: string,
  systemPrompt: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    useJSON?: boolean;
  } = {}
): Promise<string> {
  const task: AITaskMetadata & { legalTaskType: LegalTaskType } = {
    taskType: 'evidence-analysis',
    legalTaskType: 'evidence-analysis',
    context: UsageContext.USER_INITIATED,
    priority: TaskPriority.HIGH_USER,
    complexity: TaskComplexity.MEDIUM,
    description: 'Evidence analysis'
  };

  const selection = selectModelsForTask(task.legalTaskType, task.priority, task.complexity);
  log.info('Executing evidence analysis', { model: selection.primary, reasoning: selection.reasoning });

  const response = await generateUserText(
    task,
    prompt,
    {
      systemPrompt,
      temperature: options.temperature || 0.1,
      maxTokens: options.maxTokens || 2500,
      useJSON: options.useJSON,
      model: selection.primary
    }
  );

  return response.content;
}

// ============================================================================
// ML-ENHANCED ORCHESTRATION FUNCTIONS
// ============================================================================

/**
 * Convert LegalTaskType to ML Task type
 */
function convertToMLTask(
  taskType: LegalTaskType,
  priority: TaskPriority,
  complexity: TaskComplexity,
  context?: string
): MLTask {
  const mlTaskTypeMap: Record<LegalTaskType, MLTask['type']> = {
    'legal-consultation': 'legal-consultation',
    'document-generation': 'document-generation',
    'evidence-analysis': 'evidence-analysis',
    'legal-research': 'osint-research',
    'fact-extraction': 'fact-extraction',
    'legal-reasoning': 'legal-consultation',
    'precedent-search': 'osint-research',
    'statute-interpretation': 'legal-consultation'
  };

  const mlComplexityMap: Record<TaskComplexity, MLTask['complexity']> = {
    [TaskComplexity.LOW]: 'low',
    [TaskComplexity.MEDIUM]: 'medium',
    [TaskComplexity.HIGH]: 'high'
  };

  const mlPriorityMap: Record<TaskPriority, MLTask['priority']> = {
    [TaskPriority.LOW_BACKGROUND]: 'low',
    [TaskPriority.NORMAL_USER]: 'normal',
    [TaskPriority.HIGH_USER]: 'high',
    [TaskPriority.CRITICAL_USER]: 'urgent'
  };

  return {
    id: `task-${Date.now()}`,
    type: mlTaskTypeMap[taskType] || 'legal-consultation',
    complexity: mlComplexityMap[complexity] || 'medium',
    priority: mlPriorityMap[priority] || 'normal',
    context
  };
}

/**
 * Execute task with ML-enhanced model selection and ranking
 */
export async function executeWithMLRouting<T>(
  task: AITaskMetadata & { legalTaskType: LegalTaskType },
  prompt: string,
  options: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    useJSON?: boolean;
    parseResult?: (content: string) => T;
    useMultipleModels?: boolean; // Whether to use consensus approach
  } = {}
): Promise<{
  result: T;
  routing: {
    primaryModel: string;
    reasoning: string;
    confidence: number;
  };
  ranking?: {
    modelName: string;
    score: number;
    rank: number;
  }[];
}> {
  log.info('Executing task with ML routing', { taskType: task.legalTaskType });

  // Convert to ML task format
  const mlTask = convertToMLTask(
    task.legalTaskType,
    task.priority,
    task.complexity,
    prompt.substring(0, 200) // Use prompt snippet as context
  );

  // Get ML-based routing decision
  const routingResult = await routeTask(mlTask);
  const { decision } = routingResult;

  log.info('ML routing decision', {
    primaryModel: decision.primaryModel,
    confidence: decision.confidence,
    parallelize: decision.shouldParallelize
  });

  // If not using multiple models or not parallelizing, execute with primary model
  if (!options.useMultipleModels && !decision.shouldParallelize) {
    const response = await generateUserText(
      task,
      prompt,
      {
        ...options,
        model: decision.primaryModel
      }
    );

    const result = options.parseResult 
      ? options.parseResult(response.content)
      : response.content as T;

    return {
      result,
      routing: {
        primaryModel: decision.primaryModel,
        reasoning: decision.reasoning,
        confidence: decision.confidence
      }
    };
  }

  // Execute with multiple models for consensus
  const modelsToUse = decision.parallelModels || [decision.primaryModel, ...decision.fallbackModels.slice(0, 2)];
  
  const modelPromises = modelsToUse.map(async (modelName) => {
    try {
      const response = await generateUserText(
        task,
        prompt,
        {
          ...options,
          model: modelName
        }
      );

      return {
        modelName,
        response: response.content,
        metadata: {
          tokensUsed: response.tokensUsed,
          responseTime: response.responseTime
        },
        timestamp: new Date(),
        success: true
      };
    } catch (error) {
      log.warn('Model execution failed', { model: modelName, error });
      return {
        modelName,
        response: '',
        metadata: {},
        timestamp: new Date(),
        success: false
      };
    }
  });

  const results = await Promise.all(modelPromises);
  const successfulResults = results.filter(r => r.success);

  if (successfulResults.length === 0) {
    throw new Error('All models failed to execute task');
  }

  // Use ML confidence worker to analyze and rank outputs
  const modelOutputs: ModelOutput[] = successfulResults.map(r => ({
    modelName: r.modelName,
    response: r.response,
    metadata: r.metadata,
    timestamp: r.timestamp
  }));

  const confidenceAnalysis = await analyzeConfidence(modelOutputs, prompt.substring(0, 200));

  log.info('ML confidence analysis complete', {
    consensusScore: confidenceAnalysis.consensusScore,
    conflicts: confidenceAnalysis.conflicts.length,
    primaryModel: confidenceAnalysis.recommendation.primaryModel
  });

  // Get the top-ranked output
  const topRanked = confidenceAnalysis.rankedOutputs[0];
  const result = options.parseResult 
    ? options.parseResult(topRanked.response)
    : topRanked.response as T;

  return {
    result,
    routing: {
      primaryModel: topRanked.modelName,
      reasoning: confidenceAnalysis.recommendation.reasoning,
      confidence: topRanked.confidenceScore
    },
    ranking: confidenceAnalysis.rankedOutputs.map(r => ({
      modelName: r.modelName,
      score: r.confidenceScore,
      rank: r.rank
    }))
  };
}

/**
 * Execute legal consultation with ML routing
 */
export async function executeLegalConsultationWithML(
  facts: string,
  jurisdiction: string,
  lawType: string
): Promise<{
  analysis: string;
  routing: { primaryModel: string; reasoning: string; confidence: number };
  ranking?: { modelName: string; score: number; rank: number }[];
}> {
  log.info('Executing ML-enhanced legal consultation', { jurisdiction, lawType });

  const task: AITaskMetadata & { legalTaskType: LegalTaskType } = {
    legalTaskType: 'legal-consultation',
    priority: TaskPriority.HIGH_USER,
    complexity: TaskComplexity.HIGH,
    usageContext: UsageContext.LEGAL_CONSULTATION,
    userId: 'system'
  };

  const prompt = `Analyze the following legal matter:

Jurisdiction: ${jurisdiction}
Area of Law: ${lawType}

Facts:
${facts}

Provide a comprehensive legal analysis including:
1. Applicable laws and statutes
2. Key legal issues
3. Potential claims or defenses
4. Recommended next steps`;

  const result = await executeWithMLRouting(
    task,
    prompt,
    {
      systemPrompt: 'You are an expert legal consultant. Provide thorough, accurate legal analysis.',
      temperature: 0.3,
      maxTokens: 2000,
      useMultipleModels: true
    }
  );

  return {
    analysis: result.result as string,
    routing: result.routing,
    ranking: result.ranking
  };
}

// ============================================================================
// EXPORT
// ============================================================================

export const LegalModelOrchestrator = {
  selectModelsForTask,
  executeWithConsensus,
  executeLegalConsultation,
  executeDocumentGeneration,
  executeEvidenceAnalysis,
  // ML-enhanced functions
  executeWithMLRouting,
  executeLegalConsultationWithML
};
