/**
 * 4JI Orchestrator - Master AI Orchestration System
 * 
 * 4JI: Juridical Joint Intelligence Integration
 * 
 * This orchestrator manages:
 * - Sub-agent launching and coordination
 * - Parallel domain execution
 * - Crawler synchronization
 * - Research, drafting, error detection, and visual optimization
 * - Multi-model AI integration
 * - Bit-level neural pathways (ALEXARA/CRYPTARA dual-brain architecture)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { pathToFileURL } from 'url';

// Import AI providers for multi-model orchestration
import { callAIWithFallback, type AIFallbackResult } from './aiSubAgent';

// Import Bit Neural Pathway System
import { initializeBitNeuralPathways, shutdownBitNeuralPathways, getBitNeuralPathwayManager } from './bitNeuralPathways';
import { initializeALEXARA, shutdownALEXARA, getALEXARA } from './alexaraModule';
import { initializeCRYPTARA, shutdownCRYPTARA, getCRYPTARA } from './cryptaraModule';
import { initializeBeneficialCrawler, shutdownBeneficialCrawler, getBeneficialCrawler } from './beneficialCrawler';

const DOMAINS_DIR = path.join(process.cwd(), 'domains');
const ORCHESTRATOR_STATE_FILE = path.join(process.cwd(), 'data', 'orchestrator_state.json');
const ERROR_LOG_FILE = path.join(process.cwd(), 'data', 'orchestrator_errors.json');

// Event emitter for real-time orchestration updates
export const orchestratorEvents = new EventEmitter();

/**
 * Domain sub-agent interface
 */
export interface DomainSubAgent {
  domainId: string;
  name: string;
  loadKnowledgeBase: () => Promise<any>;
  processConsultation: (request: ConsultationRequest) => Promise<ConsultationResponse>;
  updateKnowledgeBase: (updates: any) => Promise<void>;
  getDomainInfo: () => DomainInfo;
}

export interface ConsultationRequest {
  userId: string;
  query: string;
  context?: Record<string, any>;
  sessionId?: string;
}

export interface ConsultationResponse {
  domainId: string;
  response: string;
  citations: string[];
  templates: string[];
  confidence: number;
  suggestedActions: string[];
}

export interface DomainInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface OrchestratorState {
  activeDomains: string[];
  lastCrawlUpdate: string;
  totalConsultations: number;
  errorCount: number;
  lastError: string | null;
  modelUsage: Record<string, number>;
  domainStats: Record<string, { consultations: number; lastUsed: string }>;
}

export interface CrawlerUpdate {
  domainId: string;
  cases?: Array<{
    id: string;
    name: string;
    citation: string;
    summary: string;
    relevance: string;
  }>;
  statutes?: Array<{
    id: string;
    name: string;
    citation: string;
    summary: string;
  }>;
  templates?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

export interface AIModelConfig {
  modelId: string;
  role: 'research' | 'reasoning' | 'inference' | 'empathy' | 'drafting' | 'coding' | 'legal_analysis';
  priority: number;
  available: boolean;
}

/**
 * AI Models available for orchestration
 * Updated December 2025: Gemini 3 models (newest flagship)
 */
const AI_MODELS: AIModelConfig[] = [
  { modelId: 'gemini-2.5-pro', role: 'research', priority: 1, available: true },
  { modelId: 'gemini-2.5-pro', role: 'legal_analysis', priority: 1, available: true },
  { modelId: 'claude-opus-4-1-20250805', role: 'reasoning', priority: 1, available: true },
  { modelId: 'claude-sonnet-4-5-20250929', role: 'drafting', priority: 1, available: true },
  { modelId: 'llama-3.3-70b-versatile', role: 'inference', priority: 2, available: true },
  { modelId: 'mistral-small-latest', role: 'coding', priority: 2, available: true },
  { modelId: 'grok-4.1', role: 'empathy', priority: 3, available: true },
  { modelId: 'qwen-72b', role: 'legal_analysis', priority: 3, available: true },
];

type DomainKnowledgeBase = {
  domain: string;
  name: string;
  version: string;
  lastUpdated: string;
  cases: Array<{ id: string; name: string; citation: string; summary: string; relevance?: string }>;
  statutes: Array<{ id: string; name: string; citation: string; summary: string }>;
  templates: Array<{ id: string; name: string; description: string }>;
  heuristics: Record<string, string>;
};

function formatDomainName(domainId: string): string {
  return domainId
    .split('-')
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function calculateKeywordRelevance(query: string, corpus: string): number {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 2);
  if (queryTerms.length === 0) return 0;

  const lowerCorpus = corpus.toLowerCase();
  const matched = queryTerms.filter(term => lowerCorpus.includes(term)).length;
  return matched / queryTerms.length;
}

function createDomainAdapter(domainId: string): DomainSubAgent {
  const domainDir = path.join(DOMAINS_DIR, domainId);
  const knowledgePath = path.join(domainDir, 'knowledge_base.json');
  const domainName = formatDomainName(domainId);
  let cache: DomainKnowledgeBase | null = null;

  const loadKnowledgeBase = async (): Promise<DomainKnowledgeBase> => {
    if (cache) return cache;
    try {
      const content = await fs.readFile(knowledgePath, 'utf8');
      const parsed = JSON.parse(content) as DomainKnowledgeBase;
      cache = parsed;
      return parsed;
    } catch {
      const fallback: DomainKnowledgeBase = {
        domain: domainId,
        name: domainName,
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        cases: [],
        statutes: [],
        templates: [],
        heuristics: {},
      };
      cache = fallback;
      await fs.mkdir(domainDir, { recursive: true });
      await fs.writeFile(knowledgePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }
  };

  const updateKnowledgeBase = async (updates: any): Promise<void> => {
    const kb = await loadKnowledgeBase();

    if (Array.isArray(updates?.cases)) {
      const ids = new Set(kb.cases.map(item => item.id));
      for (const nextCase of updates.cases) {
        if (!nextCase?.id || ids.has(nextCase.id)) continue;
        kb.cases.push(nextCase);
        ids.add(nextCase.id);
      }
    }

    if (Array.isArray(updates?.statutes)) {
      const ids = new Set(kb.statutes.map(item => item.id));
      for (const nextStatute of updates.statutes) {
        if (!nextStatute?.id || ids.has(nextStatute.id)) continue;
        kb.statutes.push(nextStatute);
        ids.add(nextStatute.id);
      }
    }

    if (Array.isArray(updates?.templates)) {
      const ids = new Set(kb.templates.map(item => item.id));
      for (const nextTemplate of updates.templates) {
        if (!nextTemplate?.id || ids.has(nextTemplate.id)) continue;
        kb.templates.push(nextTemplate);
        ids.add(nextTemplate.id);
      }
    }

    if (updates?.heuristics && typeof updates.heuristics === 'object') {
      kb.heuristics = { ...kb.heuristics, ...updates.heuristics };
    }

    kb.lastUpdated = new Date().toISOString();
    cache = kb;
    await fs.writeFile(knowledgePath, JSON.stringify(kb, null, 2));
  };

  const processConsultation = async (request: ConsultationRequest): Promise<ConsultationResponse> => {
    const kb = await loadKnowledgeBase();

    const rankedCases = kb.cases
      .map(item => ({
        item,
        relevance: calculateKeywordRelevance(request.query, `${item.name} ${item.summary} ${item.relevance || ''}`),
      }))
      .filter(entry => entry.relevance > 0.1)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5);

    const rankedStatutes = kb.statutes
      .map(item => ({
        item,
        relevance: calculateKeywordRelevance(request.query, `${item.name} ${item.summary}`),
      }))
      .filter(entry => entry.relevance > 0.1)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5);

    const citations = [
      ...rankedCases.map(entry => entry.item.citation),
      ...rankedStatutes.map(entry => entry.item.citation),
    ];

    const prompt = `You are ${domainName} counsel support. Provide a concise legal analysis for the query below.
Return strict JSON with keys: response, suggestedActions, confidence.

Query: ${request.query}
Context: ${JSON.stringify(request.context || {})}
Relevant cases: ${JSON.stringify(rankedCases.map(entry => entry.item))}
Relevant statutes: ${JSON.stringify(rankedStatutes.map(entry => entry.item))}
Heuristics: ${JSON.stringify(kb.heuristics)}`;

    try {
      const ai = await callAIWithFallback(prompt, {
        taskName: `${domainId}_consultation`,
        temperature: 0.2,
        maxTokens: 2048,
      });

      const normalized = (ai.content || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(normalized);
      return {
        domainId,
        response: typeof parsed.response === 'string' ? parsed.response : ai.content || 'No response generated.',
        citations,
        templates: kb.templates.map(template => template.id),
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(parsed.confidence, 1)) : 0.65,
        suggestedActions: Array.isArray(parsed.suggestedActions)
          ? parsed.suggestedActions.filter((value: unknown): value is string => typeof value === 'string')
          : Object.values(kb.heuristics),
      };
    } catch {
      return {
        domainId,
        response: `Found ${rankedCases.length} relevant cases and ${rankedStatutes.length} relevant statutes for ${domainName}.`,
        citations,
        templates: kb.templates.map(template => template.id),
        confidence: Math.min(0.95, 0.35 + rankedCases.length * 0.1 + rankedStatutes.length * 0.1),
        suggestedActions: Object.values(kb.heuristics).length > 0
          ? Object.values(kb.heuristics)
          : [`Collect more jurisdiction-specific facts for ${domainName}.`],
      };
    }
  };

  return {
    domainId,
    name: domainName,
    loadKnowledgeBase,
    processConsultation,
    updateKnowledgeBase,
    getDomainInfo: () => ({
      id: domainId,
      name: domainName,
      description: `${domainName} domain adapter`,
      icon: 'Scale',
    }),
  };
}

// Cache for loaded sub-agents
const subAgentCache: Map<string, DomainSubAgent> = new Map();

// Orchestrator state
let orchestratorState: OrchestratorState = {
  activeDomains: [],
  lastCrawlUpdate: new Date().toISOString(),
  totalConsultations: 0,
  errorCount: 0,
  lastError: null,
  modelUsage: {},
  domainStats: {}
};

/**
 * Initialize the orchestrator
 */
export async function initializeOrchestrator(): Promise<void> {
  console.log('[4JI Orchestrator] Initializing...');
  
  try {
    // Load existing state
    await loadOrchestratorState();
    
    // Discover available domains
    const domains = await discoverDomains();
    orchestratorState.activeDomains = domains;
    
    console.log(`[4JI Orchestrator] Discovered ${domains.length} domains`);
    
    // Pre-load domain sub-agents
    for (const domainId of domains) {
      try {
        await loadSubAgent(domainId);
      } catch (error: any) {
        console.warn(`[4JI Orchestrator] Failed to pre-load ${domainId}:`, error.message);
      }
    }
    
    // Initialize Bit Neural Pathways System (ALEXARA/CRYPTARA dual-brain)
    try {
      console.log('[4JI Orchestrator] Initializing Bit Neural Pathways...');
      await initializeBitNeuralPathways();
      await initializeALEXARA();
      await initializeCRYPTARA();
      await initializeBeneficialCrawler({ crawlInterval: 60000 }); // 1 minute crawl interval
      console.log('[4JI Orchestrator] Bit Neural Pathways initialized');
    } catch (neuralError: any) {
      console.warn('[4JI Orchestrator] Neural pathways initialization warning:', neuralError.message);
      // Non-fatal - continue without neural pathways
    }
    
    await saveOrchestratorState();
    
    console.log('[4JI Orchestrator] Initialization complete');
    orchestratorEvents.emit('initialized', { domains });
  } catch (error: any) {
    console.error('[4JI Orchestrator] Initialization failed:', error.message);
    await logError('initialization', error);
    throw error;
  }
}

/**
 * Discover available domains by scanning the domains directory
 */
export async function discoverDomains(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    const domains = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    
    return domains;
  } catch (error: any) {
    console.error('[4JI Orchestrator] Failed to discover domains:', error.message);
    return [];
  }
}

/**
 * Load a domain sub-agent dynamically
 */
export async function loadSubAgent(domainId: string): Promise<DomainSubAgent> {
  // Check cache first
  if (subAgentCache.has(domainId)) {
    return subAgentCache.get(domainId)!;
  }

  const domainDir = path.join(DOMAINS_DIR, domainId);
  const candidateFiles = ['sub_agent.js', 'sub_agent.mjs', 'sub_agent.cjs', 'sub_agent.ts'];

  try {
    for (const candidate of candidateFiles) {
      const candidatePath = path.join(domainDir, candidate);
      try {
        await fs.access(candidatePath);
      } catch {
        continue;
      }

      // In production, .ts loaders are often unavailable under bundled ESM runtime.
      if (candidate.endsWith('.ts')) {
        console.warn(`[4JI Orchestrator] Skipping direct TypeScript domain module for ${domainId}; using runtime adapter`);
        break;
      }

      const moduleUrl = pathToFileURL(candidatePath).href;
      const loaded = await import(moduleUrl);
      const exported = (loaded.default && typeof loaded.default === 'object') ? loaded.default : loaded;

      const loadKnowledgeBase = typeof exported.loadKnowledgeBase === 'function' ? exported.loadKnowledgeBase.bind(exported) : null;
      const processConsultation = typeof exported.processConsultation === 'function' ? exported.processConsultation.bind(exported) : null;
      const updateKnowledgeBase = typeof exported.updateKnowledgeBase === 'function' ? exported.updateKnowledgeBase.bind(exported) : null;
      const getDomainInfo = typeof exported.getDomainInfo === 'function' ? exported.getDomainInfo.bind(exported) : null;

      if (!loadKnowledgeBase || !processConsultation || !updateKnowledgeBase || !getDomainInfo) {
        throw new Error(`Sub-agent module ${candidatePath} missing required exports`);
      }

      const agent: DomainSubAgent = {
        domainId,
        name: getDomainInfo()?.name || domainId,
        loadKnowledgeBase,
        processConsultation,
        updateKnowledgeBase,
        getDomainInfo,
      };

      subAgentCache.set(domainId, agent);
      console.log(`[4JI Orchestrator] Loaded sub-agent module: ${domainId} (${candidate})`);
      return agent;
    }

    const adapter = createDomainAdapter(domainId);
    subAgentCache.set(domainId, adapter);
    console.log(`[4JI Orchestrator] Loaded adaptive sub-agent adapter: ${domainId}`);
    return adapter;
  } catch (error: any) {
    console.error(`[4JI Orchestrator] Failed to load sub-agent ${domainId}:`, error.message);
    throw error;
  }
}

/**
 * Launch a sub-agent for a specific domain
 */
export async function launchSubAgent(
  domainId: string,
  request: ConsultationRequest
): Promise<ConsultationResponse> {
  console.log(`[4JI Orchestrator] Launching sub-agent for domain: ${domainId}`);
  
  const startTime = Date.now();
  
  try {
    const subAgent = await loadSubAgent(domainId);
    
    // Load knowledge base
    await subAgent.loadKnowledgeBase();
    
    // Process the consultation
    const response = await subAgent.processConsultation(request);
    
    // Update stats
    orchestratorState.totalConsultations++;
    orchestratorState.domainStats[domainId] = {
      consultations: (orchestratorState.domainStats[domainId]?.consultations || 0) + 1,
      lastUsed: new Date().toISOString()
    };
    
    await saveOrchestratorState();
    
    const duration = Date.now() - startTime;
    console.log(`[4JI Orchestrator] Sub-agent ${domainId} completed in ${duration}ms`);
    
    orchestratorEvents.emit('consultation_complete', { domainId, duration, response });
    
    return response;
  } catch (error: any) {
    await logError(`launch_${domainId}`, error);
    throw error;
  }
}

/**
 * Execute parallel consultations across multiple domains
 */
export async function parallelExecution(
  domainIds: string[],
  request: ConsultationRequest
): Promise<Map<string, ConsultationResponse | Error>> {
  console.log(`[4JI Orchestrator] Parallel execution for ${domainIds.length} domains`);
  
  const results = new Map<string, ConsultationResponse | Error>();
  
  // Execute all domains in parallel
  const promises = domainIds.map(async (domainId) => {
    try {
      const response = await launchSubAgent(domainId, request);
      results.set(domainId, response);
    } catch (error: any) {
      results.set(domainId, error);
    }
  });
  
  await Promise.all(promises);
  
  orchestratorEvents.emit('parallel_complete', { domainIds, results });
  
  return results;
}

/**
 * Synchronize crawler updates to a domain's knowledge base
 */
export async function synchronizeCrawlerUpdate(update: CrawlerUpdate): Promise<void> {
  console.log(`[4JI Orchestrator] Synchronizing crawler update for: ${update.domainId}`);
  
  try {
    const subAgent = await loadSubAgent(update.domainId);
    
    await subAgent.updateKnowledgeBase({
      cases: update.cases,
      statutes: update.statutes,
      templates: update.templates
    });
    
    orchestratorState.lastCrawlUpdate = new Date().toISOString();
    await saveOrchestratorState();
    
    orchestratorEvents.emit('crawler_sync', { domainId: update.domainId, update });
    
    console.log(`[4JI Orchestrator] Crawler update synchronized for: ${update.domainId}`);
  } catch (error: any) {
    await logError(`crawler_sync_${update.domainId}`, error);
    throw error;
  }
}

/**
 * Perform deep research using AI models
 */
export async function performResearch(
  query: string,
  domainId?: string
): Promise<{ findings: string; sources: string[]; confidence: number }> {
  console.log(`[4JI Orchestrator] Performing research: ${query.substring(0, 50)}...`);
  
  const researchPrompt = `You are a legal research AI. Perform comprehensive research on the following query:

Query: ${query}
${domainId ? `Domain: ${domainId}` : ''}

Provide:
1. Key findings and analysis
2. Relevant case law citations
3. Applicable statutes
4. Legal precedents

Format your response as JSON with fields: findings, citations, statutes, precedents, confidence`;

  try {
    const result = await callAIWithFallback(researchPrompt, {
      taskName: 'legal_research',
      temperature: 0.3,
      maxTokens: 4096
    });
    
    if (result.success && result.content) {
      // Track model usage
      if (result.provider) {
        orchestratorState.modelUsage[result.provider] = 
          (orchestratorState.modelUsage[result.provider] || 0) + 1;
      }
      
      try {
        const parsed = JSON.parse(result.content.replace(/```json\n?|\n?```/g, ''));
        return {
          findings: parsed.findings || result.content,
          sources: [...(parsed.citations || []), ...(parsed.statutes || [])],
          confidence: parsed.confidence || 0.7
        };
      } catch {
        return {
          findings: result.content,
          sources: [],
          confidence: 0.6
        };
      }
    }
    
    return {
      findings: 'Research unavailable',
      sources: [],
      confidence: 0.1
    };
  } catch (error: any) {
    await logError('research', error);
    return {
      findings: `Research failed: ${error.message}`,
      sources: [],
      confidence: 0
    };
  }
}

/**
 * Generate legal document draft
 */
export async function generateDraft(
  documentType: string,
  context: Record<string, any>,
  domainId: string
): Promise<{ draft: string; metadata: Record<string, any> }> {
  console.log(`[4JI Orchestrator] Generating ${documentType} draft for ${domainId}`);
  
  const draftPrompt = `You are a legal document drafting AI. Generate a professional ${documentType} for the following context:

Domain: ${domainId}
Context: ${JSON.stringify(context, null, 2)}

Generate a complete, professionally formatted legal document.`;

  try {
    const result = await callAIWithFallback(draftPrompt, {
      taskName: 'legal_drafting',
      temperature: 0.5,
      maxTokens: 8192
    });
    
    if (result.success && result.content) {
      return {
        draft: result.content,
        metadata: {
          documentType,
          domainId,
          generatedAt: new Date().toISOString(),
          model: result.provider
        }
      };
    }
    
    return {
      draft: '',
      metadata: { error: 'Draft generation failed' }
    };
  } catch (error: any) {
    await logError('drafting', error);
    return {
      draft: '',
      metadata: { error: error.message }
    };
  }
}

/**
 * Detect and fix errors autonomously
 */
export async function detectAndFixErrors(): Promise<{
  detected: number;
  fixed: number;
  pending: string[];
}> {
  console.log('[4JI Orchestrator] Running error detection and fix...');
  
  const detected: string[] = [];
  const fixed: string[] = [];
  const pending: string[] = [];
  
  // Check each domain for issues
  for (const domainId of orchestratorState.activeDomains) {
    try {
      const subAgent = await loadSubAgent(domainId);
      await subAgent.loadKnowledgeBase();
    } catch (error: any) {
      detected.push(`${domainId}: ${error.message}`);
      
      // Attempt automatic fix
      try {
        // Re-initialize knowledge base
        const kbPath = path.join(DOMAINS_DIR, domainId, 'knowledge_base.json');
        const kbExists = await fs.access(kbPath).then(() => true).catch(() => false);
        
        if (!kbExists) {
          // Create minimal knowledge base
          const minimalKb = {
            domain: domainId,
            name: domainId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            cases: [],
            statutes: [],
            templates: [],
            heuristics: {}
          };
          await fs.writeFile(kbPath, JSON.stringify(minimalKb, null, 2));
          fixed.push(domainId);
        } else {
          pending.push(domainId);
        }
      } catch {
        pending.push(domainId);
      }
    }
  }
  
  orchestratorEvents.emit('error_detection_complete', { detected, fixed, pending });
  
  return {
    detected: detected.length,
    fixed: fixed.length,
    pending
  };
}

/**
 * Optimize visual elements (SEO, layout, performance)
 */
export async function optimizeVisuals(): Promise<{
  optimizations: string[];
  score: number;
}> {
  const optimizations: string[] = [];
  
  // Check UI configs for all domains
  for (const domainId of orchestratorState.activeDomains) {
    try {
      const uiConfigPath = path.join(DOMAINS_DIR, domainId, 'ui_config.json');
      const content = await fs.readFile(uiConfigPath, 'utf-8');
      const config = JSON.parse(content);
      
      // Check for accessibility features
      if (!config.accessibility?.highContrast) {
        optimizations.push(`${domainId}: Enable high contrast mode`);
      }
      if (!config.accessibility?.screenReaderOptimized) {
        optimizations.push(`${domainId}: Optimize for screen readers`);
      }
      if (!config.features?.voiceInput) {
        optimizations.push(`${domainId}: Enable voice input`);
      }
    } catch (error: any) {
      optimizations.push(`${domainId}: UI config needs attention`);
    }
  }
  
  const score = Math.max(0, 100 - (optimizations.length * 5));
  
  return { optimizations, score };
}

/**
 * Get best AI model for a specific task
 */
export function getBestModelForTask(
  role: AIModelConfig['role']
): AIModelConfig | null {
  const availableModels = AI_MODELS
    .filter(m => m.role === role && m.available)
    .sort((a, b) => a.priority - b.priority);
  
  return availableModels[0] || null;
}

/**
 * Merge outputs from multiple AI models into coherent response
 */
export async function mergeAIOutputs(
  outputs: Array<{ model: string; content: string; confidence: number }>
): Promise<string> {
  // Sort by confidence
  const sorted = outputs.sort((a, b) => b.confidence - a.confidence);
  
  if (sorted.length === 0) return '';
  if (sorted.length === 1) return sorted[0].content;
  
  // Use highest confidence output as base, enhanced by others
  const primary = sorted[0];
  const supplementary = sorted.slice(1);
  
  const mergePrompt = `Merge the following AI outputs into a single coherent response:

Primary (${primary.model}, confidence: ${primary.confidence}):
${primary.content}

Supplementary outputs:
${supplementary.map(s => `[${s.model}, confidence: ${s.confidence}]: ${s.content}`).join('\n\n')}

Create a unified, comprehensive response that incorporates the best elements from all outputs.`;

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
 * Get orchestrator status
 */
export function getOrchestratorStatus(): OrchestratorState {
  return { ...orchestratorState };
}

/**
 * Get all domain information
 */
export async function getAllDomainInfo(): Promise<DomainInfo[]> {
  const domains: DomainInfo[] = [];
  
  for (const domainId of orchestratorState.activeDomains) {
    try {
      const subAgent = await loadSubAgent(domainId);
      domains.push(subAgent.getDomainInfo());
    } catch {
      domains.push({
        id: domainId,
        name: domainId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: 'Domain information unavailable',
        icon: 'FileQuestion'
      });
    }
  }
  
  return domains;
}

/**
 * Load orchestrator state from file
 */
async function loadOrchestratorState(): Promise<void> {
  try {
    const content = await fs.readFile(ORCHESTRATOR_STATE_FILE, 'utf-8');
    orchestratorState = { ...orchestratorState, ...JSON.parse(content) };
  } catch {
    // Use default state if file doesn't exist
    console.log('[4JI Orchestrator] No existing state found, using defaults');
  }
}

/**
 * Save orchestrator state to file
 */
async function saveOrchestratorState(): Promise<void> {
  try {
    const stateDir = path.dirname(ORCHESTRATOR_STATE_FILE);
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(ORCHESTRATOR_STATE_FILE, JSON.stringify(orchestratorState, null, 2));
  } catch (error: any) {
    console.error('[4JI Orchestrator] Failed to save state:', error.message);
  }
}

/**
 * Log error to file
 */
async function logError(context: string, error: Error): Promise<void> {
  orchestratorState.errorCount++;
  orchestratorState.lastError = `${context}: ${error.message}`;
  
  try {
    const errorDir = path.dirname(ERROR_LOG_FILE);
    await fs.mkdir(errorDir, { recursive: true });
    
    let errors: any[] = [];
    try {
      const content = await fs.readFile(ERROR_LOG_FILE, 'utf-8');
      errors = JSON.parse(content);
    } catch {}
    
    errors.push({
      timestamp: new Date().toISOString(),
      context,
      message: error.message,
      stack: error.stack
    });
    
    // Keep only last 100 errors
    if (errors.length > 100) {
      errors = errors.slice(-100);
    }
    
    await fs.writeFile(ERROR_LOG_FILE, JSON.stringify(errors, null, 2));
  } catch (err: any) {
    console.error('[4JI Orchestrator] Failed to log error:', err.message);
  }
  
  await saveOrchestratorState();
}

/**
 * Get neural pathway system status
 */
export function getNeuralPathwayStatus(): {
  initialized: boolean;
  pathwayMetrics: any;
  alexaraMetrics: any;
  cryptaraMetrics: any;
  crawlerMetrics: any;
} {
  try {
    const pathwayManager = getBitNeuralPathwayManager();
    const alexara = getALEXARA();
    const cryptara = getCRYPTARA();
    const crawler = getBeneficialCrawler();

    return {
      initialized: pathwayManager.isInitialized() && alexara.isInitialized() && cryptara.isInitialized(),
      pathwayMetrics: pathwayManager.isInitialized() ? pathwayManager.getMetrics() : null,
      alexaraMetrics: alexara.isInitialized() ? alexara.getMetrics() : null,
      cryptaraMetrics: cryptara.isInitialized() ? cryptara.getMetrics() : null,
      crawlerMetrics: crawler.isInitialized() ? crawler.getMetrics() : null
    };
  } catch {
    return {
      initialized: false,
      pathwayMetrics: null,
      alexaraMetrics: null,
      cryptaraMetrics: null,
      crawlerMetrics: null
    };
  }
}

/**
 * Perform neural-enhanced legal analysis
 */
export async function performNeuralLegalAnalysis(
  situation: string,
  lawType: string,
  jurisdiction: string
): Promise<any> {
  try {
    const alexara = getALEXARA();
    if (!alexara.isInitialized()) {
      await initializeALEXARA();
    }
    return await alexara.analyzeLegalSituation(situation, lawType, jurisdiction);
  } catch (error: any) {
    console.error('[4JI Orchestrator] Neural legal analysis failed:', error.message);
    return {
      error: error.message,
      confidence: 0,
      causesOfAction: [],
      defenses: [],
      requiredElements: [],
      potentialRemedies: [],
      precedentPatterns: []
    };
  }
}

/**
 * Perform neural-enhanced pattern analysis
 */
export async function performNeuralPatternAnalysis(
  data: Record<string, unknown>,
  category: 'network' | 'transaction' | 'behavioral' | 'temporal'
): Promise<any> {
  try {
    const cryptara = getCRYPTARA();
    if (!cryptara.isInitialized()) {
      await initializeCRYPTARA();
    }
    return await cryptara.analyzePatterns(data, category);
  } catch (error: any) {
    console.error('[4JI Orchestrator] Neural pattern analysis failed:', error.message);
    return {
      error: error.message,
      confidence: 0,
      detectedPatterns: [],
      networkNodes: [],
      predictions: [],
      riskAssessment: 0,
      sandboxCompliant: true
    };
  }
}

/**
 * Shutdown neural pathway system
 */
export async function shutdownNeuralPathways(): Promise<void> {
  console.log('[4JI Orchestrator] Shutting down neural pathways...');
  try {
    await shutdownBeneficialCrawler();
    await shutdownCRYPTARA();
    await shutdownALEXARA();
    await shutdownBitNeuralPathways();
    console.log('[4JI Orchestrator] Neural pathways shutdown complete');
  } catch (error: any) {
    console.error('[4JI Orchestrator] Neural pathways shutdown error:', error.message);
  }
}

export default {
  initializeOrchestrator,
  discoverDomains,
  loadSubAgent,
  launchSubAgent,
  parallelExecution,
  synchronizeCrawlerUpdate,
  performResearch,
  generateDraft,
  detectAndFixErrors,
  optimizeVisuals,
  getBestModelForTask,
  mergeAIOutputs,
  getOrchestratorStatus,
  getAllDomainInfo,
  getNeuralPathwayStatus,
  performNeuralLegalAnalysis,
  performNeuralPatternAnalysis,
  shutdownNeuralPathways,
  orchestratorEvents
};
