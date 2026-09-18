/**
 * AI Model Orchestration Module
 * 
 * Integrates multiple free AI models with specific roles:
 * - Research: Deep search and case law retrieval
 * - Reasoning: Logical analysis and inference
 * - Empathy: Understanding human context
 * - Drafting: Document generation
 * - Coding: Technical implementations
 * - Legal Analysis: Domain-specific expertise
 * 
 * All outputs merge through 4JI orchestration for coherent decisions.
 */

import { callAIWithFallback, type AIFallbackResult } from './aiSubAgent';
import {
  HARMONY_17_PARTICIPANTS,
  getConfiguredHarmonyParticipants,
  type HarmonyCapability,
} from './aiHarmonyModelRegistry';

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  roles: AIRole[];
  maxTokens: number;
  temperature: number;
  available: boolean;
  costPerToken?: number;
}

export type AIRole = 
  | 'research'
  | 'reasoning'
  | 'inference'
  | 'empathy'
  | 'drafting'
  | 'coding'
  | 'legal_analysis'
  | 'summarization'
  | 'translation';

export interface ModelOutput {
  modelId: string;
  role: AIRole;
  content: string;
  confidence: number;
  tokensUsed: number;
  latencyMs: number;
  metadata?: Record<string, any>;
}

export interface OrchestrationResult {
  success: boolean;
  mergedContent: string;
  outputs: ModelOutput[];
  confidence: number;
  totalTokens: number;
  totalLatencyMs: number;
  primaryModel: string;
}

/**
 * Available AI models configuration
 * These are the free/open models integrated into the system
 * Compatibility layer aligned to current Harmony model generations
 */
const ROLE_CAPABILITIES: Record<AIRole, readonly HarmonyCapability[]> = {
  research: ['research', 'verification'],
  reasoning: ['deep-reasoning', 'verification'],
  inference: ['deep-reasoning', 'structured-output'],
  empathy: ['fast-chat', 'long-context'],
  drafting: ['legal-analysis', 'structured-output'],
  coding: ['coding', 'deep-reasoning'],
  legal_analysis: ['legal-analysis', 'verification', 'deep-reasoning'],
  summarization: ['fast-chat', 'long-context'],
  translation: ['long-context', 'fast-chat'],
};

/**
 * Compatibility metadata generated from the canonical 17-participant Harmony
 * registry. There is no provider priority encoded here.
 */
export const AI_MODELS: AIModel[] = HARMONY_17_PARTICIPANTS.map(participant => ({
  id: participant.model,
  name: participant.model,
  provider: String(participant.provider),
  roles: (Object.keys(ROLE_CAPABILITIES) as AIRole[]).filter(role =>
    ROLE_CAPABILITIES[role].some(capability => participant.capabilities.includes(capability)),
  ),
  maxTokens: 8192,
  temperature: 0.3,
  available: participant.configured(),
}));

/**
 * Get available models for a specific role
 */
export function getModelsForRole(role: AIRole): AIModel[] {
  return AI_MODELS.filter(m => m.available && m.roles.includes(role));
}

/**
 * Compatibility helper returning a capability match for metadata only.
 * Runtime execution is still performed by the complete configured Harmony mesh.
 */
export function getBestModelForRole(role: AIRole): AIModel | null {
  const configured = getConfiguredHarmonyParticipants();
  const pool = configured.length > 0 ? configured : [...HARMONY_17_PARTICIPANTS];
  const required = ROLE_CAPABILITIES[role];
  const selected = pool
    .map(participant => ({
      participant,
      score: required.filter(capability => participant.capabilities.includes(capability)).length,
    }))
    .sort((a, b) => b.score - a.score)[0]?.participant;
  if (!selected) return null;
  return {
    id: selected.model,
    name: selected.model,
    provider: String(selected.provider),
    roles: [role],
    maxTokens: 8192,
    temperature: 0.3,
    available: selected.configured(),
  };
}

/**
 * Get all available models
 */
export function getAvailableModels(): AIModel[] {
  return AI_MODELS.filter(m => m.available);
}

/**
 * Execute a task with a specific model
 */
export async function executeWithModel(
  model: AIModel,
  prompt: string,
  role: AIRole
): Promise<ModelOutput> {
  const startTime = Date.now();
  
  try {
    const result = await callAIWithFallback(prompt, {
      taskName: `${model.id}_${role}`,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      // model is advisory metadata only. callAIWithFallback enters the full
      // Harmony mesh before any route-local recovery chain.
    });
    
    const latencyMs = Date.now() - startTime;
    
    return {
      modelId: model.id,
      role,
      content: result.content || '',
      confidence: result.success ? 0.8 : 0.2,
      tokensUsed: 0, // Token counting not available in fallback result
      latencyMs,
      metadata: {
        provider: result.provider,
        model: result.provider || 'unknown'
      }
    };
  } catch (error: any) {
    return {
      modelId: model.id,
      role,
      content: `Error: ${error.message}`,
      confidence: 0,
      tokensUsed: 0,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Execute parallel tasks across multiple roles
 */
export async function executeParallelRoles(
  prompt: string,
  roles: AIRole[]
): Promise<ModelOutput[]> {
  const tasks = roles.map(async (role) => {
    const model = getBestModelForRole(role);
    if (!model) {
      return {
        modelId: 'none',
        role,
        content: `No model available for role: ${role}`,
        confidence: 0,
        tokensUsed: 0,
        latencyMs: 0
      };
    }
    return executeWithModel(model, prompt, role);
  });
  
  return Promise.all(tasks);
}

/**
 * Merge multiple AI outputs into a coherent response
 * Uses confidence metadata while final synthesis still enters Harmony
 */
export async function mergeOutputs(outputs: ModelOutput[]): Promise<string> {
  if (outputs.length === 0) return '';
  if (outputs.length === 1) return outputs[0].content;
  
  // Sort by confidence
  const sorted = outputs.sort((a, b) => b.confidence - a.confidence);
  
  // Filter out errors and low confidence
  const valid = sorted.filter(o => o.confidence > 0.3 && !o.content.startsWith('Error:'));
  
  if (valid.length === 0) {
    return sorted[0].content; // Return highest confidence even if error
  }
  
  if (valid.length === 1) {
    return valid[0].content;
  }
  
  const mergePrompt = `Synthesize these independent Harmony role analyses into a single coherent response.

ANALYSES:
${valid.map(s => `[${s.role}, confidence metadata: ${s.confidence}]: ${s.content}`).join('\n\n')}

Create a unified response that:
1. Weighs claims by evidentiary support and relevant capability, not provider identity or list order
2. Reconciles disagreements conservatively
3. Incorporates unique supported insights and removes redundancy
4. Maintains professional legal tone`;

  try {
    const result = await callAIWithFallback(mergePrompt, {
      taskName: 'merge_outputs',
      temperature: 0.3,
      maxTokens: 4096
    });
    
    return result.content || valid[0].content;
  } catch {
    return valid[0].content;
  }
}

/**
 * Full orchestration pipeline for a query
 */
export async function orchestrateQuery(
  query: string,
  domainId: string,
  requestedRoles?: AIRole[]
): Promise<OrchestrationResult> {
  const startTime = Date.now();
  
  // Default roles based on query type
  const roles = requestedRoles || determineRolesForQuery(query);
  
  // Execute parallel analysis
  const outputs = await executeParallelRoles(
    `Domain: ${domainId}\n\nQuery: ${query}`,
    roles
  );
  
  // Filter successful outputs
  const successful = outputs.filter(o => o.confidence > 0);
  
  // Merge outputs
  const mergedContent = await mergeOutputs(successful);
  
  // Calculate totals
  const totalTokens = outputs.reduce((sum, o) => sum + o.tokensUsed, 0);
  const avgConfidence = successful.length > 0
    ? successful.reduce((sum, o) => sum + o.confidence, 0) / successful.length
    : 0;
  
  const primaryOutput = successful[0];
  
  return {
    success: successful.length > 0,
    mergedContent,
    outputs,
    confidence: avgConfidence,
    totalTokens,
    totalLatencyMs: Date.now() - startTime,
    primaryModel: primaryOutput?.modelId || 'none'
  };
}

/**
 * Determine which roles to use based on query content
 */
function determineRolesForQuery(query: string): AIRole[] {
  const queryLower = query.toLowerCase();
  const roles: AIRole[] = [];
  
  // Always include legal analysis
  roles.push('legal_analysis');
  
  // Research for case law / statute queries
  if (queryLower.includes('case') || 
      queryLower.includes('statute') || 
      queryLower.includes('precedent') ||
      queryLower.includes('law')) {
    roles.push('research');
  }
  
  // Reasoning for complex analysis
  if (queryLower.includes('analyze') || 
      queryLower.includes('evaluate') ||
      queryLower.includes('compare') ||
      queryLower.includes('argument')) {
    roles.push('reasoning');
  }
  
  // Drafting for document requests
  if (queryLower.includes('draft') || 
      queryLower.includes('write') ||
      queryLower.includes('template') ||
      queryLower.includes('letter')) {
    roles.push('drafting');
  }
  
  // Empathy for personal situations
  if (queryLower.includes('help') || 
      queryLower.includes('situation') ||
      queryLower.includes('problem') ||
      queryLower.includes('advice')) {
    roles.push('empathy');
  }
  
  // Inference for logical deduction
  if (queryLower.includes('conclude') || 
      queryLower.includes('determine') ||
      queryLower.includes('infer') ||
      queryLower.includes('likely')) {
    roles.push('inference');
  }
  
  // Ensure at least 2 roles
  if (roles.length < 2) {
    roles.push('research');
  }
  
  return [...new Set(roles)]; // Remove duplicates
}

/**
 * Get model availability status
 */
export function getModelStatus(): {
  total: number;
  available: number;
  byProvider: Record<string, number>;
  byRole: Record<AIRole, number>;
} {
  const available = getAvailableModels();
  
  const byProvider: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  
  for (const model of available) {
    byProvider[model.provider] = (byProvider[model.provider] || 0) + 1;
    for (const role of model.roles) {
      byRole[role] = (byRole[role] || 0) + 1;
    }
  }
  
  return {
    total: AI_MODELS.length,
    available: available.length,
    byProvider,
    byRole: byRole as Record<AIRole, number>
  };
}

export default {
  AI_MODELS,
  getModelsForRole,
  getBestModelForRole,
  getAvailableModels,
  executeWithModel,
  executeParallelRoles,
  mergeOutputs,
  orchestrateQuery,
  getModelStatus
};
