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

export interface AIModel {
  id: string;
  name: string;
  provider: 'gemini' | 'openrouter' | 'groq' | 'mistral' | 'anthropic' | 'local';
  roles: AIRole[];
  maxTokens: number;
  temperature: number;
  available: boolean;
  priority: number;
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
 * Updated December 2025: Gemini 3 models (newest flagship)
 */
export const AI_MODELS: AIModel[] = [
  // Google Gemini 3 - Primary for research and legal analysis (NEWEST)
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 3 Pro',
    provider: 'gemini',
    roles: ['research', 'legal_analysis', 'summarization', 'reasoning'],
    maxTokens: 8192,
    temperature: 0.3,
    available: !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY,
    priority: 1
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 3 Flash',
    provider: 'gemini',
    roles: ['research', 'drafting', 'inference'],
    maxTokens: 8192,
    temperature: 0.4,
    available: !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY,
    priority: 2
  },
  
  // Anthropic Claude - Reasoning and empathy
  {
    id: 'claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    provider: 'anthropic',
    roles: ['reasoning', 'empathy', 'legal_analysis'],
    maxTokens: 4096,
    temperature: 0.5,
    available: !!process.env.ANTHROPIC_API_KEY,
    priority: 2
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'anthropic',
    roles: ['drafting', 'summarization'],
    maxTokens: 4096,
    temperature: 0.6,
    available: !!process.env.ANTHROPIC_API_KEY,
    priority: 3
  },
  
  // OpenRouter Models - Various specialized tasks
  {
    id: 'llama-3-70b',
    name: 'Llama 3 70B',
    provider: 'openrouter',
    roles: ['inference', 'reasoning', 'coding'],
    maxTokens: 4096,
    temperature: 0.4,
    available: !!process.env.OPENROUTER_API_KEY,
    priority: 2
  },
  {
    id: 'llama-3.1-405b',
    name: 'Llama 3.1 405B',
    provider: 'openrouter',
    roles: ['research', 'legal_analysis', 'reasoning'],
    maxTokens: 8192,
    temperature: 0.3,
    available: !!process.env.OPENROUTER_API_KEY,
    priority: 1
  },
  
  // Groq - Fast inference
  {
    id: 'groq-llama-70b',
    name: 'Groq Llama 70B',
    provider: 'groq',
    roles: ['empathy', 'summarization', 'drafting'],
    maxTokens: 4096,
    temperature: 0.5,
    available: !!process.env.GROQ_API_KEY,
    priority: 3
  },
  {
    id: 'groq-mixtral',
    name: 'Groq Mixtral',
    provider: 'groq',
    roles: ['coding', 'inference'],
    maxTokens: 4096,
    temperature: 0.3,
    available: !!process.env.GROQ_API_KEY,
    priority: 3
  },
  
  // Mistral - Specialized coding and inference
  {
    id: 'mistral-7b',
    name: 'Mistral 7B',
    provider: 'mistral',
    roles: ['coding', 'inference', 'drafting'],
    maxTokens: 4096,
    temperature: 0.4,
    available: !!process.env.MISTRAL_API_KEY,
    priority: 4
  },
  {
    id: 'mistral-medium',
    name: 'Mistral Medium',
    provider: 'mistral',
    roles: ['legal_analysis', 'research'],
    maxTokens: 4096,
    temperature: 0.3,
    available: !!process.env.MISTRAL_API_KEY,
    priority: 3
  }
];

/**
 * Get available models for a specific role
 */
export function getModelsForRole(role: AIRole): AIModel[] {
  return AI_MODELS
    .filter(m => m.available && m.roles.includes(role))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get the best available model for a role
 */
export function getBestModelForRole(role: AIRole): AIModel | null {
  const models = getModelsForRole(role);
  return models.length > 0 ? models[0] : null;
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
      preferredProvider: (model.provider === 'gemini' || model.provider === 'groq' || model.provider === 'mistral') ? model.provider : undefined
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
 * Uses weighted averaging based on confidence and role priority
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
  
  // Use primary output, enhanced by supplementary information
  const primary = valid[0];
  const supplementary = valid.slice(1);
  
  // Simple merge for now - in production, use AI to merge
  const mergePrompt = `Synthesize these AI analysis outputs into a single coherent response:

PRIMARY ANALYSIS (${primary.role}, confidence: ${primary.confidence}):
${primary.content}

SUPPLEMENTARY ANALYSES:
${supplementary.map(s => `[${s.role}]: ${s.content}`).join('\n\n')}

Create a unified response that:
1. Prioritizes the primary analysis
2. Incorporates unique insights from supplementary analyses
3. Removes redundancy
4. Maintains professional legal tone`;

  try {
    const result = await callAIWithFallback(mergePrompt, {
      taskName: 'merge_outputs',
      temperature: 0.3,
      maxTokens: 4096
    });
    
    return result.content || primary.content;
  } catch {
    return primary.content;
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
