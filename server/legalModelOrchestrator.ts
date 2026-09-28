/**
 * Legal Model Orchestrator - Enhanced with ML Intelligence
 * Enhanced multi-model orchestration specifically for legal tasks
 * 
 * Provides capability scoring, result fusion, and consensus analysis for legal
 * tasks while the shared Harmony orchestrator remains the sole execution
 * authority over the complete configured model mesh.
 * 
 * Integrates ML workers for:
 * - Confidence scoring and ranking of model outputs
 * - Intelligent task routing to optimal models
 * - Conflict resolution between model opinions
 */

import { generateUserText, TaskPriority, TaskComplexity, UsageContext, type AITaskMetadata } from './aiProvider';
import { AICollaborationOrchestrator } from './aiCollaborationOrchestrator';
import {
  HARMONY_17_PARTICIPANTS,
  getConfiguredHarmonyParticipants,
  getConfiguredHarmonyProviders,
  isHarmonyProviderAllowed,
  type HarmonyCapability,
} from './aiHarmonyModelRegistry';
import { createLogger } from './logger';
import {
  routeTask,
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

const LEGAL_TASK_CAPABILITIES: Record<LegalTaskType, readonly HarmonyCapability[]> = {
  'legal-consultation': ['legal-analysis', 'deep-reasoning', 'verification'],
  'document-generation': ['legal-analysis', 'structured-output'],
  'evidence-analysis': ['multimodal', 'verification', 'deep-reasoning'],
  'legal-research': ['research', 'verification', 'long-context'],
  'fact-extraction': ['structured-output', 'verification'],
  'legal-reasoning': ['legal-analysis', 'deep-reasoning'],
  'precedent-search': ['research', 'verification'],
  'statute-interpretation': ['legal-analysis', 'deep-reasoning', 'verification'],
};

const LEGAL_TASK_TYPES = Object.keys(LEGAL_TASK_CAPABILITIES) as LegalTaskType[];

/**
 * Compatibility metadata generated from the canonical Harmony registry.
 * Neutral cost/accuracy defaults avoid fabricating provider-specific rankings.
 */
const MODEL_CAPABILITIES: ModelCapability[] = HARMONY_17_PARTICIPANTS.map(participant => ({
  modelName: participant.model,
  strengths: LEGAL_TASK_TYPES.filter(taskType =>
    LEGAL_TASK_CAPABILITIES[taskType].some(capability => participant.capabilities.includes(capability)),
  ),
  weaknesses: [],
  costRating: 'medium',
  speedRating: participant.capabilities.includes('fast-chat') ? 'fast' : 'medium',
  accuracyRating: 80,
}));

// ============================================================================
// MODEL SELECTION ENGINE
// ============================================================================

/**
 * Produce an advisory capability match for status/ML metadata. This does not
 * restrict runtime participation: all configured Harmony participants still
 * execute in the shared orchestrator.
 */
export function selectModelsForTask(
  taskType: LegalTaskType,
  priority: TaskPriority,
  complexity: TaskComplexity
): ModelSelection {
  const configured = getConfiguredHarmonyParticipants('legalwhat');
  const pool = configured.length > 0 ? configured : HARMONY_17_PARTICIPANTS.filter(participant => isHarmonyProviderAllowed(participant.provider, 'legalwhat'));
  const required = LEGAL_TASK_CAPABILITIES[taskType];

  const scored = pool
    .map(participant => {
      let score = required.filter(capability => participant.capabilities.includes(capability)).length * 10;
      if (
        complexity === TaskComplexity.COMPREHENSIVE
        && participant.capabilities.includes('deep-reasoning')
      ) score += 4;
      if (
        priority >= TaskPriority.HIGH_USER
        && participant.capabilities.includes('verification')
      ) score += 2;
      if (
        priority <= TaskPriority.MEDIUM_BACKGROUND
        && participant.capabilities.includes('fast-chat')
      ) score += 1;
      return { participant, score };
    })
    .sort((a, b) => b.score - a.score);

  const primary = scored[0]?.participant.model || 'harmony-current';
  const fallback = scored.slice(1).map(item => item.participant.model);

  return {
    primary,
    fallback,
    reasoning:
      `Capability match for ${taskType}: ${primary}. Advisory only; full configured Harmony participation remains authoritative.`,
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
    modelCount?: number; // Compatibility only; Harmony always uses every configured participant.
    parseResult?: (content: string) => T;
  } = {}
): Promise<ConsensusResult<T>> {
  const providers = getConfiguredHarmonyProviders('legalwhat');

  log.info('Executing legal task through full Harmony consensus', {
    taskType: task.legalTaskType,
    configuredParticipants: providers.length,
  });

  if (providers.length === 0) {
    const response = await generateUserText(
      `${task.legalTaskType}-consensus-local-fallback`,
      prompt,
      {
        providerPolicy: 'legalwhat',
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        useJSON: options.useJSON,
      },
      task.priority,
    );
    const parsed = options.parseResult
      ? options.parseResult(response.content)
      : response.content as T;
    return {
      result: parsed,
      confidence: 0.5,
      agreement: 1,
      modelResults: [{ model: 'local-fallback', result: parsed }],
      conflicts: ['No external Harmony participants were configured.'],
      recommendation: 'needs-review',
    };
  }

  const researchTask = ['legal-research', 'precedent-search', 'statute-interpretation'].includes(task.legalTaskType);
  const orchestrated = await AICollaborationOrchestrator.orchestrateCollaboration(
    `${task.legalTaskType}-consensus`,
    prompt,
    {
      complexity: task.complexity as any,
      priority:
        task.priority >= TaskPriority.CRITICAL_USER ? 'critical'
          : task.priority >= TaskPriority.HIGH_USER ? 'high'
            : task.priority >= TaskPriority.MEDIUM_BACKGROUND ? 'medium'
              : 'low',
      context: task.context,
      estimatedTokens: options.maxTokens,
      needsLegalAnalysis: true,
      needsVerification: true,
      needsSearchGrounding: researchTask,
      needsReasoning: true,
      needsStructuredOutput: options.useJSON === true,
      needsFastResponse: false,
    } as any,
    providers,
    {
      providerPolicy: 'legalwhat',
      systemPrompt: options.systemPrompt,
    },
  );

  const successfulResults: Array<{
    model: string;
    result: T;
    success: boolean;
    reasoning?: string;
  }> = [];

  for (const contribution of orchestrated.contributions) {
    if (contribution.role === 'harmony-synthesizer' || !contribution.success || !contribution.content?.trim()) {
      continue;
    }
    try {
      const parsed = options.parseResult
        ? options.parseResult(contribution.content)
        : contribution.content as T;
      successfulResults.push({
        model: contribution.model,
        result: parsed,
        success: true,
      });
    } catch (error) {
      log.warn('Harmony contribution could not be parsed for consensus metadata', {
        model: contribution.model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (successfulResults.length === 0) {
    throw new Error('Harmony produced no parseable legal-analysis contributions');
  }

  const consensus = analyzeConsensus(successfulResults);

  // Harmony synthesis is the final response authority. Participant agreement is
  // retained as confidence metadata, never as a competing execution authority.
  try {
    consensus.result = options.parseResult
      ? options.parseResult(orchestrated.finalAnswer)
      : orchestrated.finalAnswer as T;
  } catch {
    // Keep the participant-derived consensus result if structured synthesis
    // parsing fails; the parsing defect stays local instead of discarding all work.
  }

  log.info('Harmony legal consensus complete', {
    taskType: task.legalTaskType,
    agreement: consensus.agreement,
    confidence: consensus.confidence,
    participants: successfulResults.length,
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
 * Execute legal consultation through full Harmony
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
  const legalTaskType: LegalTaskType = 'legal-consultation';

  if (options.useConsensus) {
    const task: AITaskMetadata & { legalTaskType: LegalTaskType } = {
      taskName: 'legal-consultation',
      legalTaskType,
      context: UsageContext.USER,
      priority: TaskPriority.HIGH_USER,
      complexity: TaskComplexity.COMPREHENSIVE,
      isUserFacing: true,
      allowDeferral: false
    };
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

  const selection = selectModelsForTask(legalTaskType, TaskPriority.HIGH_USER, TaskComplexity.COMPREHENSIVE);
  log.info('Executing legal consultation through Harmony', { advisoryMatch: selection.primary, reasoning: selection.reasoning });

  const response = await generateUserText(
    'legal-consultation',
    prompt,
    {
      providerPolicy: 'legalwhat',
      systemPrompt,
      temperature: options.temperature || 0.3,
      maxTokens: options.maxTokens || 3000
    },
    TaskPriority.HIGH_USER
  );

  return response.content;
}

/**
 * Execute document generation through full Harmony
 */
export async function executeDocumentGeneration(
  prompt: string,
  systemPrompt: string,
  options: {
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const legalTaskType: LegalTaskType = 'document-generation';

  const selection = selectModelsForTask(legalTaskType, TaskPriority.HIGH_USER, TaskComplexity.MODERATE);
  log.info('Executing document generation through Harmony', { advisoryMatch: selection.primary, reasoning: selection.reasoning });

  const response = await generateUserText(
    'document-generation',
    prompt,
    {
      providerPolicy: 'legalwhat',
      systemPrompt,
      temperature: options.temperature || 0.3,
      maxTokens: options.maxTokens || 4000
    },
    TaskPriority.HIGH_USER
  );

  return response.content;
}

/**
 * Execute evidence analysis through full Harmony
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
  const legalTaskType: LegalTaskType = 'evidence-analysis';

  const selection = selectModelsForTask(legalTaskType, TaskPriority.HIGH_USER, TaskComplexity.MODERATE);
  log.info('Executing evidence analysis through Harmony', { advisoryMatch: selection.primary, reasoning: selection.reasoning });

  const response = await generateUserText(
    'evidence-analysis',
    prompt,
    {
      providerPolicy: 'legalwhat',
      systemPrompt,
      temperature: options.temperature || 0.1,
      maxTokens: options.maxTokens || 2500,
      useJSON: options.useJSON
    },
    TaskPriority.HIGH_USER
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
    [TaskComplexity.LIGHTWEIGHT]: 'low',
    [TaskComplexity.MODERATE]: 'medium',
    [TaskComplexity.COMPREHENSIVE]: 'high'
  };

  const mlPriorityMap: Record<TaskPriority, MLTask['priority']> = {
    [TaskPriority.LOWEST_MAINTENANCE]: 'low',
    [TaskPriority.LOW_BACKGROUND]: 'low',
    [TaskPriority.MEDIUM_BACKGROUND]: 'normal',
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
    useMultipleModels?: boolean;
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
  log.info('Executing task with ML capability advice and Harmony authority', {
    taskType: task.legalTaskType,
  });

  const mlTask = convertToMLTask(
    task.legalTaskType,
    task.priority,
    task.complexity,
    prompt.substring(0, 200),
  );
  const routingResult = await routeTask(mlTask);
  const { decision } = routingResult;

  if (options.useMultipleModels || decision.shouldParallelize) {
    const consensus = await executeWithConsensus<T>(
      task,
      prompt,
      {
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        useJSON: options.useJSON,
        parseResult: options.parseResult,
      },
    );

    return {
      result: consensus.result,
      routing: {
        primaryModel: decision.primaryModel,
        reasoning:
          `${decision.reasoning}. Advisory capability match only; execution and synthesis used the full configured Harmony mesh.`,
        confidence: consensus.confidence,
      },
    };
  }

  const response = await generateUserText(
    `${task.legalTaskType}-ml-routing`,
    prompt,
    {
      providerPolicy: 'legalwhat',
      systemPrompt: options.systemPrompt,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      useJSON: options.useJSON,
    },
    task.priority,
  );

  const result = options.parseResult
    ? options.parseResult(response.content)
    : response.content as T;

  return {
    result,
    routing: {
      primaryModel: decision.primaryModel,
      reasoning:
        `${decision.reasoning}. Advisory capability match only; execution used the full configured Harmony mesh.`,
      confidence: decision.confidence,
    },
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
    taskName: 'ml-legal-consultation',
    legalTaskType: 'legal-consultation',
    priority: TaskPriority.HIGH_USER,
    complexity: TaskComplexity.COMPREHENSIVE,
    isUserFacing: true,
    allowDeferral: false,
    context: UsageContext.USER
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
