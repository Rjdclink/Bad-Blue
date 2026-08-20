/**
 * 4JI (Forge AI) - Unified Master Orchestrator
 * 
 * ARCHITECTURE:
 * - Single decision-making intelligence coordinating all AI models
 * - Split operational domains: LegalWhat vs Crypto Crawler
 * - Strict separation with no cross-domain control
 * - Shared optimized infrastructure, isolated execution
 * 
 * AI MODEL INTEGRATION (17+ Models):
 * - Gemini 3 Pro Preview, Gemini 2.5 Flash, Gemini 1.5 Pro
 * - Claude 4.5 Opus (orchestrator), Claude 3.5 Sonnet, Claude 3.5 Haiku
 * - Groq LLaMA 3.3-70B Versatile, LLaMA 3.1-8B Instant
 * - Mistral Large Latest, Mistral Small Latest, Mistral 7B Instruct
 * - DeepSeek R1T2, Qwen 72B, Kimi K2
 * - GPT-5 Mini, Grok 4.1
 * - Meta LLaMA 3.3-70B Instruct, Hermes 3 LLaMA 3.1 405B
 * 
 * CAPABILITIES:
 * - Advanced inference and reasoning
 * - Coding, drafting, and legal filing
 * - Visual optimization and research
 * - Autonomous evolution and self-improvement
 */

import { createLogger } from '../../logger';
import { DomainFirewall, Domain } from './domain-firewall';
import { AIProvider, TaskComplexity, TaskPriority, UsageContext, type AITaskMetadata } from '../../aiTokenGovernor';
import { runProvider } from '../../aiProvider';
import { deepSeekSearch, grokSearch, kimiSearch, qwenSearch } from '../../openRouterService';

const log = createLogger('4JI-Orchestrator');

/**
 * AI Model configuration for the unified orchestrator
 */
export interface AIModelConfig {
  id: string;
  name: string;
  provider: AIProvider;
  capabilities: AICapability[];
  domains: Domain[];
  maxTokens: number;
  costTier: 'free' | 'low' | 'medium' | 'high' | 'premium';
  speedTier: 'instant' | 'fast' | 'medium' | 'slow';
  contextWindow: number;
}

/**
 * AI Capabilities
 */
export type AICapability = 
  | 'reasoning'
  | 'coding'
  | 'legal-analysis'
  | 'creative-writing'
  | 'data-extraction'
  | 'pattern-recognition'
  | 'visual-analysis'
  | 'long-context'
  | 'fast-inference'
  | 'research'
  | 'trading-analysis'
  | 'market-prediction'
  | 'blockchain-interaction'
  | 'document-generation'
  | 'verification'
  | 'orchestration';

export type OrchestrationRole =
  | 'architecture'
  | 'coding'
  | 'review'
  | 'testing'
  | 'security'
  | 'research';

export interface RoleAssignment {
  role: OrchestrationRole;
  primaryModelId: string;
  fallbackModelIds: string[];
}

/**
 * Orchestrator status
 */
export interface OrchestratorStatus {
  isInitialized: boolean;
  isRunning: boolean;
  uptime: number;
  activeDomain: Domain | null;
  modelsLoaded: number;
  totalOperations: number;
  legalwhatStats: DomainStats;
  cryptocrawlerStats: DomainStats;
  systemHealth: number; // 0-100
}

/**
 * Domain-specific statistics
 */
interface DomainStats {
  operations: number;
  errors: number;
  evolutionCycles: number;
  lastActivity: Date | null;
  activeSubAgents: number;
  workerFunctions: number;
}

interface ModelExecutionResult {
  model: AIModelConfig;
  content: string;
  tokensUsed: number;
}

const ROLE_CAPABILITY_MAP: Record<OrchestrationRole, AICapability[]> = {
  architecture: ['reasoning', 'orchestration', 'long-context'],
  coding: ['coding', 'reasoning', 'verification'],
  review: ['reasoning', 'verification', 'pattern-recognition'],
  testing: ['verification', 'reasoning', 'coding'],
  security: ['verification', 'reasoning', 'pattern-recognition'],
  research: ['research', 'reasoning', 'long-context'],
};

/**
 * Task definition for orchestrated execution
 */
export interface OrchestratedTask {
  id: string;
  domain: Domain;
  type: string;
  priority: TaskPriority;
  requiredCapabilities: AICapability[];
  roles?: OrchestrationRole[];
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Task result from orchestrated execution
 */
export interface OrchestratedResult {
  taskId: string;
  domain: Domain;
  success: boolean;
  result: unknown;
  modelsUsed: string[];
  tokensUsed: number;
  latencyMs: number;
  confidenceScore: number;
  error?: string;
}

/**
 * 4JI Unified Master Orchestrator
 */
export class ForgeAI {
  private static isInitialized = false;
  private static isRunning = false;
  private static startTime = 0;
  private static totalOperations = 0;
  
  // Model registry
  private static models: Map<string, AIModelConfig> = new Map();
  
  // Domain-specific sub-agents and workers (tracked separately)
  private static subAgents: Map<Domain, string[]> = new Map();
  private static workerFunctions: Map<Domain, string[]> = new Map();
  private static roleAssignments: Map<OrchestrationRole, RoleAssignment> = new Map();
  
  // Evolution tracking
  private static evolutionCycles: Map<Domain, number> = new Map();
  
  /**
   * Initialize the 4JI Unified Orchestrator
   */
  static async initialize(): Promise<void> {
    if (this.isInitialized) {
      log.warn('4JI Orchestrator already initialized');
      return;
    }

    log.info('🔥 Initializing 4JI (Forge AI) Unified Master Orchestrator...');

    try {
      // Phase 1: Initialize domain firewall
      log.info('Phase 1: Initializing Domain Firewall');
      DomainFirewall.initialize();

      // Phase 2: Register AI models
      log.info('Phase 2: Registering AI Models');
      this.registerModels();

      // Phase 2.5: Build role assignments with redundancy
      log.info('Phase 2.5: Building role assignments');
      this.buildRoleAssignments();

      // Phase 3: Initialize domain-specific sub-agents
      log.info('Phase 3: Initializing Sub-Agents');
      await this.initializeSubAgents();

      // Phase 4: Initialize worker functions
      log.info('Phase 4: Initializing Worker Functions');
      await this.initializeWorkerFunctions();

      // Phase 5: Initialize evolution tracking
      log.info('Phase 5: Initializing Evolution Tracking');
      this.evolutionCycles.set(Domain.LEGAL_WHAT, 0);
      this.evolutionCycles.set(Domain.CRYPTO_CRAWLER, 0);

      this.isInitialized = true;
      this.startTime = Date.now();

      log.info('✅ 4JI Unified Master Orchestrator Initialized', {
        models: this.models.size,
        subAgents: {
          legalwhat: this.subAgents.get(Domain.LEGAL_WHAT)?.length || 0,
          cryptocrawler: this.subAgents.get(Domain.CRYPTO_CRAWLER)?.length || 0,
        },
        isolationVerified: DomainFirewall.verifyIsolation().isIsolated,
      });

    } catch (error) {
      log.error('Failed to initialize 4JI Orchestrator', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Register all AI models
   */
  private static registerModels(): void {
    const models: AIModelConfig[] = [
      // Gemini models
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 3 Pro Preview',
        provider: AIProvider.GEMINI,
        capabilities: ['reasoning', 'visual-analysis', 'long-context', 'research', 'orchestration'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 32768,
        costTier: 'medium',
        speedTier: 'medium',
        contextWindow: 1000000,
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: AIProvider.GEMINI,
        capabilities: ['fast-inference', 'reasoning', 'data-extraction'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'low',
        speedTier: 'fast',
        contextWindow: 128000,
      },
      
      // Claude models
      {
        id: 'claude-opus-4-1-20250805',
        name: 'Claude Opus 4.1',
        provider: AIProvider.CLAUDE_OPUS,
        capabilities: ['reasoning', 'legal-analysis', 'creative-writing', 'orchestration', 'long-context'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 16384,
        costTier: 'premium',
        speedTier: 'slow',
        contextWindow: 200000,
      },
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        provider: AIProvider.CLAUDE,
        capabilities: ['reasoning', 'legal-analysis', 'document-generation', 'verification'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'high',
        speedTier: 'medium',
        contextWindow: 200000,
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        provider: AIProvider.CLAUDE,
        capabilities: ['fast-inference', 'verification', 'data-extraction'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 4096,
        costTier: 'medium',
        speedTier: 'fast',
        contextWindow: 200000,
      },
      
      // Groq models (autonomous priority)
      {
        id: 'llama-3.3-70b-versatile',
        name: 'LLaMA 3.3 70B Versatile',
        provider: AIProvider.GROQ,
        capabilities: ['reasoning', 'coding', 'fast-inference', 'research'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 32768,
        costTier: 'free',
        speedTier: 'instant',
        contextWindow: 131072,
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'LLaMA 3.1 8B Instant',
        provider: AIProvider.GROQ,
        capabilities: ['fast-inference', 'data-extraction'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'free',
        speedTier: 'instant',
        contextWindow: 131072,
      },
      
      // Mistral models
      {
        id: 'mistral-small-latest',
        name: 'Mistral Small Latest',
        provider: AIProvider.MISTRAL,
        capabilities: ['reasoning', 'coding', 'legal-analysis', 'fast-inference', 'data-extraction', 'verification'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'free',
        speedTier: 'fast',
        contextWindow: 128000,
      },
      
      // DeepSeek
      {
        id: 'deepseek-r1t2',
        name: 'DeepSeek R1T2 Chimera',
        provider: AIProvider.DEEPSEEK,
        capabilities: ['reasoning', 'coding', 'pattern-recognition'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 16384,
        costTier: 'medium',
        speedTier: 'medium',
        contextWindow: 64000,
      },
      
      // Grok (massive context)
      {
        id: 'grok-4.1',
        name: 'Grok 4.1 Fast',
        provider: AIProvider.GROK,
        capabilities: ['long-context', 'visual-analysis', 'research'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 32768,
        costTier: 'high',
        speedTier: 'fast',
        contextWindow: 1000000,
      },
      
      // Kimi (structured output)
      {
        id: 'kimi-k2',
        name: 'Kimi K2',
        provider: AIProvider.KIMI,
        capabilities: ['data-extraction', 'pattern-recognition', 'verification'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'medium',
        speedTier: 'medium',
        contextWindow: 128000,
      },
      
      // GPT-5 Mini (fast inference)
      {
        id: 'gpt5-mini',
        name: 'GPT-5 Mini',
        provider: AIProvider.GPT5_MINI,
        capabilities: ['fast-inference', 'reasoning', 'pattern-recognition'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'medium',
        speedTier: 'instant',
        contextWindow: 128000,
      },
      
      // Qwen (multilingual)
      {
        id: 'qwen-72b',
        name: 'Qwen 2.5 72B Instruct',
        provider: AIProvider.QWEN,
        capabilities: ['reasoning', 'coding', 'long-context'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 32768,
        costTier: 'free',
        speedTier: 'medium',
        contextWindow: 128000,
      },
      
      // Specialized: Crypto Crawler only
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Trading AI Specialist',
        provider: AIProvider.GROQ,
        capabilities: ['trading-analysis', 'market-prediction', 'pattern-recognition'],
        domains: [Domain.CRYPTO_CRAWLER],
        maxTokens: 16384,
        costTier: 'free',
        speedTier: 'instant',
        contextWindow: 32000,
      },
      
      // Specialized: Legal only
      {
        id: 'legal-ai',
        name: 'Legal AI Specialist',
        provider: AIProvider.CLAUDE,
        capabilities: ['legal-analysis', 'document-generation', 'research'],
        domains: [Domain.LEGAL_WHAT],
        maxTokens: 16384,
        costTier: 'high',
        speedTier: 'medium',
        contextWindow: 200000,
      },
    ];

    for (const model of models) {
      this.models.set(model.id, model);
    }

    log.info('Registered AI models', { count: this.models.size });
  }

  /**
   * Build role-to-model assignments with deterministic fallbacks.
   */
  private static buildRoleAssignments(): void {
    this.roleAssignments.clear();

    const roles: OrchestrationRole[] = ['architecture', 'coding', 'review', 'testing', 'security', 'research'];
    for (const role of roles) {
      const capabilities = ROLE_CAPABILITY_MAP[role];
      const minimumMatch = Math.min(2, capabilities.length);
      const candidates = Array.from(this.models.values())
        .map(model => ({
          model,
          matchedCapabilities: capabilities.filter(capability => model.capabilities.includes(capability)).length,
        }))
        .filter(candidate => candidate.matchedCapabilities >= minimumMatch)
        .sort((a, b) => {
          if (a.matchedCapabilities !== b.matchedCapabilities) {
            return b.matchedCapabilities - a.matchedCapabilities;
          }

          const priorityA = this.providerPriority(a.model.provider);
          const priorityB = this.providerPriority(b.model.provider);
          if (priorityA !== priorityB) return priorityA - priorityB;
          return this.speedRank(a.model.speedTier) - this.speedRank(b.model.speedTier);
        });

      if (candidates.length === 0) {
        throw new Error(`No candidate models available for 4JI role '${role}'`);
      }

      const primary = candidates[0].model;
      const fallbackModelIds = candidates.slice(1, 4).map(candidate => candidate.model.id);

      this.roleAssignments.set(role, {
        role,
        primaryModelId: primary.id,
        fallbackModelIds,
      });
    }

    log.info('Role assignments ready', {
      roles: Array.from(this.roleAssignments.values()),
    });
  }

  /**
   * Initialize domain-specific sub-agents
   */
  private static async initializeSubAgents(): Promise<void> {
    // LegalWhat sub-agents
    const legalSubAgents = [
      'legal-research-agent',
      'document-drafting-agent',
      'evidence-analysis-agent',
      'legal-filing-agent',
      'client-communication-agent',
      'ux-optimization-agent',
      'seo-agent',
      'accessibility-agent',
    ];

    // Crypto Crawler sub-agents
    const cryptoSubAgents = [
      'market-analysis-agent',
      'trading-execution-agent',
      'arbitrage-detection-agent',
      'risk-assessment-agent',
      'blockchain-monitoring-agent',
      'gas-optimization-agent',
      'faucet-controller-agent',
      'dashboard-analytics-agent',
    ];

    this.subAgents.set(Domain.LEGAL_WHAT, legalSubAgents);
    this.subAgents.set(Domain.CRYPTO_CRAWLER, cryptoSubAgents);

    log.info('Sub-agents initialized', {
      legalwhat: legalSubAgents.length,
      cryptocrawler: cryptoSubAgents.length,
    });
  }

  /**
   * Initialize worker functions
   */
  private static async initializeWorkerFunctions(): Promise<void> {
    // LegalWhat worker functions
    const legalWorkers = [
      'processConsultation',
      'generateDocument',
      'analyzeEvidence',
      'searchPrecedents',
      'extractFacts',
      'checkCompliance',
      'optimizeUX',
      'improveAccessibility',
    ];

    // Crypto Crawler worker functions
    const cryptoWorkers = [
      'scanMarkets',
      'executeArbitrage',
      'calculateGas',
      'monitorPositions',
      'detectOpportunities',
      'manageFaucet',
      'updateDashboard',
      'runSimulation',
    ];

    this.workerFunctions.set(Domain.LEGAL_WHAT, legalWorkers);
    this.workerFunctions.set(Domain.CRYPTO_CRAWLER, cryptoWorkers);

    log.info('Worker functions initialized', {
      legalwhat: legalWorkers.length,
      cryptocrawler: cryptoWorkers.length,
    });
  }

  /**
   * Start the orchestrator
   */
  static async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      log.warn('4JI Orchestrator already running');
      return;
    }

    log.info('🚀 Starting 4JI Unified Master Orchestrator...');
    this.isRunning = true;

    log.info('✅ 4JI Orchestrator Running', {
      status: this.getStatus(),
    });
  }

  /**
   * Execute a task within the appropriate domain
   */
  static async executeTask(task: OrchestratedTask): Promise<OrchestratedResult> {
    this.ensureRunning();

    const startTime = Date.now();
    this.totalOperations++;

    log.debug('Executing orchestrated task', {
      taskId: task.id,
      domain: task.domain,
      type: task.type,
    });

    try {
      // Execute within isolated domain context
      const result = await DomainFirewall.executeInDomain(
        task.domain,
        `task:${task.type}`,
        async (context) => {
          if (task.roles && task.roles.length > 0) {
            const roleExecution = await this.executeRoleBased(task);
            return roleExecution;
          }

          // Select optimal models for this task
          const selectedModels = this.selectModelsForTask(task);
          
          // Track in domain context
          DomainFirewall.storeState(task.domain, `lastTask:${task.id}`, {
            type: task.type,
            timestamp: new Date(),
          });

          const executionResult = await this.executeWithModels(task, selectedModels);
          
          return executionResult;
        }
      );

      return {
        taskId: task.id,
        domain: task.domain,
        success: true,
        result: result.content,
        modelsUsed: result.modelsUsed,
        tokensUsed: result.tokensUsed,
        latencyMs: Date.now() - startTime,
        confidenceScore: result.confidence,
      };

    } catch (error) {
      log.error('Task execution failed', {
        taskId: task.id,
        domain: task.domain,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        taskId: task.id,
        domain: task.domain,
        success: false,
        result: null,
        modelsUsed: [],
        tokensUsed: 0,
        latencyMs: Date.now() - startTime,
        confidenceScore: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Select optimal models for a task based on required capabilities
   */
  private static selectModelsForTask(task: OrchestratedTask): AIModelConfig[] {
    const eligibleModels: AIModelConfig[] = [];

    for (const model of this.models.values()) {
      // Check domain compatibility
      if (!model.domains.includes(task.domain)) {
        continue;
      }

      // Check capability match
      const hasRequiredCapabilities = task.requiredCapabilities.every(
        cap => model.capabilities.includes(cap)
      );

      if (hasRequiredCapabilities) {
        eligibleModels.push(model);
      }
    }

    // Sort by priority score (speed + cost efficiency)
    eligibleModels.sort((a, b) => {
      const scoreA = this.calculateModelScore(a, task);
      const scoreB = this.calculateModelScore(b, task);
      return scoreB - scoreA;
    });

    // Return top 3 models for potential parallel execution
    return eligibleModels.slice(0, 3);
  }

  /**
   * Calculate model score for task matching
   */
  private static calculateModelScore(model: AIModelConfig, task: OrchestratedTask): number {
    let score = 0;

    // Speed scoring
    const speedScores = { instant: 100, fast: 75, medium: 50, slow: 25 };
    score += speedScores[model.speedTier] * (task.priority >= TaskPriority.HIGH_USER ? 1.5 : 1);

    // Cost scoring (lower is better for background tasks)
    const costScores = { free: 100, low: 80, medium: 60, high: 40, premium: 20 };
    score += costScores[model.costTier] * (task.priority <= TaskPriority.LOW_BACKGROUND ? 1.5 : 1);

    // Capability match bonus
    const capabilityMatch = task.requiredCapabilities.filter(
      cap => model.capabilities.includes(cap)
    ).length;
    score += capabilityMatch * 20;

    return score;
  }

  /**
   * Execute task with selected models
   */
  private static async executeWithModels(
    task: OrchestratedTask,
    models: AIModelConfig[]
  ): Promise<{ content: unknown; modelsUsed: string[]; tokensUsed: number; confidence: number }> {
    if (models.length === 0) {
      throw new Error(`No suitable models found for task ${task.id} with capabilities: ${task.requiredCapabilities.join(', ')}`);
    }

    const primaryModel = models[0];
    log.debug('Executing with model', {
      taskId: task.id,
      model: primaryModel.id,
    });

    const execution = await this.executeSingleModel(primaryModel, task);
    const content = execution.content;
    const tokensUsed = execution.tokensUsed;

    if (!content) {
      throw new Error(`Model ${primaryModel.id} returned an empty response`);
    }

    return {
      content,
      modelsUsed: [primaryModel.id],
      tokensUsed,
      confidence: 0.8,
    };
  }

  /**
   * Execute task using explicit role assignments and resolve disagreement via reviewer model.
   */
  private static async executeRoleBased(
    task: OrchestratedTask
  ): Promise<{ content: unknown; modelsUsed: string[]; tokensUsed: number; confidence: number }> {
    const requestedRoles = (task.roles || []).filter((role, index, roles) => roles.indexOf(role) === index);
    const modelIds = new Set<string>();

    for (const role of requestedRoles) {
      const assignment = this.roleAssignments.get(role);
      if (!assignment) {
        throw new Error(`Role '${role}' is not configured in 4JI assignments`);
      }

      modelIds.add(assignment.primaryModelId);
      for (const fallbackId of assignment.fallbackModelIds) {
        modelIds.add(fallbackId);
      }
    }

    const candidateModels = Array.from(modelIds)
      .map(id => this.models.get(id))
      .filter((model): model is AIModelConfig => Boolean(model))
      .filter(model => model.domains.includes(task.domain));

    if (candidateModels.length === 0) {
      throw new Error(`No domain-compatible models found for roles: ${requestedRoles.join(', ')}`);
    }

    const executionResults: ModelExecutionResult[] = [];
    for (const model of candidateModels.slice(0, 3)) {
      try {
        executionResults.push(await this.executeSingleModel(model, task));
      } catch (error) {
        log.warn('Role-based candidate model failed', {
          taskId: task.id,
          model: model.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (executionResults.length === 0) {
      throw new Error(`All role-based models failed for task ${task.id}`);
    }

    if (executionResults.length === 1) {
      return {
        content: executionResults[0].content,
        modelsUsed: [executionResults[0].model.id],
        tokensUsed: executionResults[0].tokensUsed,
        confidence: 0.78,
      };
    }

    const reviewer = this.resolveReviewerModel(task.domain);
    const consensusPrompt = `You are 4JI consensus resolver. Resolve disagreements between specialist model outputs and produce one final answer.
Task type: ${task.type}
Domain: ${task.domain}
Original prompt: ${task.prompt}

Candidate outputs:\n${executionResults
      .map((result, index) => `Model ${index + 1} (${result.model.id}):\n${result.content}`)
      .join('\n\n')}

Return a single consolidated response.`;

    const consensusExecution = await this.executeSingleModel(reviewer, {
      ...task,
      prompt: consensusPrompt,
      requiredCapabilities: ['reasoning', 'verification'],
    });

    const modelsUsed = [
      ...executionResults.map(result => result.model.id),
      consensusExecution.model.id,
    ];

    return {
      content: consensusExecution.content,
      modelsUsed,
      tokensUsed: executionResults.reduce((sum, entry) => sum + entry.tokensUsed, 0) + consensusExecution.tokensUsed,
      confidence: 0.88,
    };
  }

  private static resolveReviewerModel(domain: Domain): AIModelConfig {
    const preferred = Array.from(this.models.values())
      .filter(model => model.domains.includes(domain))
      .filter(model => model.capabilities.includes('verification') && model.capabilities.includes('reasoning'))
      .sort((a, b) => this.providerPriority(a.provider) - this.providerPriority(b.provider));

    if (preferred.length === 0) {
      throw new Error(`No reviewer model available for domain ${domain}`);
    }

    return preferred[0];
  }

  private static async executeSingleModel(model: AIModelConfig, task: OrchestratedTask): Promise<ModelExecutionResult> {
    const taskMetadata: AITaskMetadata = {
      taskName: `forge-${task.type}`,
      priority: task.priority,
      complexity: task.requiredCapabilities.includes('reasoning') || task.requiredCapabilities.includes('legal-analysis')
        ? TaskComplexity.COMPREHENSIVE
        : TaskComplexity.MODERATE,
      isUserFacing: task.priority >= TaskPriority.HIGH_USER,
      allowDeferral: false,
      context: task.priority >= TaskPriority.HIGH_USER ? UsageContext.USER : UsageContext.AUTONOMOUS,
    };

    const maxTokens = Math.min(task.maxTokens ?? model.maxTokens, model.maxTokens);
    const options = {
      model: model.id,
      systemPrompt: task.systemPrompt,
      temperature: task.temperature,
    };

    let content = '';
    let tokensUsed = 0;

    switch (model.provider) {
      case AIProvider.GEMINI:
      case AIProvider.GROQ:
      case AIProvider.MISTRAL:
      case AIProvider.CLAUDE: {
        const response = await runProvider(model.provider, task.prompt, options, maxTokens, taskMetadata);
        content = response.content;
        tokensUsed = response.tokensUsed;
        break;
      }
      case AIProvider.CLAUDE_OPUS: {
        const response = await runProvider(AIProvider.CLAUDE, task.prompt, options, maxTokens, taskMetadata);
        content = response.content;
        tokensUsed = response.tokensUsed;
        break;
      }
      case AIProvider.DEEPSEEK:
        content = (await deepSeekSearch(task.prompt))?.content ?? '';
        break;
      case AIProvider.QWEN:
        content = (await qwenSearch(task.prompt))?.content ?? '';
        break;
      case AIProvider.GROK:
        content = (await grokSearch(task.prompt))?.content ?? '';
        break;
      case AIProvider.KIMI:
        content = (await kimiSearch(task.prompt))?.content ?? '';
        break;
      default: {
        log.warn('Provider does not have a dedicated integration; using Groq fallback', {
          taskId: task.id,
          provider: model.provider,
        });
        const response = await runProvider(AIProvider.GROQ, task.prompt, {}, maxTokens, taskMetadata);
        content = response.content;
        tokensUsed = response.tokensUsed;
      }
    }

    if (!content) {
      throw new Error(`Model ${model.id} returned an empty response`);
    }

    return {
      model,
      content,
      tokensUsed,
    };
  }

  private static providerPriority(provider: AIProvider): number {
    switch (provider) {
      case AIProvider.CLAUDE_OPUS:
      case AIProvider.CLAUDE:
        return 1;
      case AIProvider.GEMINI:
        return 2;
      case AIProvider.GROQ:
        return 3;
      case AIProvider.MISTRAL:
        return 4;
      case AIProvider.GROK:
      case AIProvider.DEEPSEEK:
      case AIProvider.QWEN:
      case AIProvider.KIMI:
        return 5;
      default:
        return 6;
    }
  }

  private static speedRank(speed: AIModelConfig['speedTier']): number {
    switch (speed) {
      case 'instant':
        return 1;
      case 'fast':
        return 2;
      case 'medium':
        return 3;
      case 'slow':
        return 4;
      default:
        return 5;
    }
  }

  /**
   * Trigger evolution cycle for a domain
   */
  static async triggerEvolution(domain: Domain): Promise<void> {
    this.ensureRunning();

    log.info('Triggering evolution cycle', { domain });

    await DomainFirewall.executeInDomain(
      domain,
      'evolution-cycle',
      async (context) => {
        const currentCycle = this.evolutionCycles.get(domain) || 0;
        this.evolutionCycles.set(domain, currentCycle + 1);

        // Record evolution in isolated context
        DomainFirewall.recordEvolution(domain, {
          cycle: currentCycle + 1,
          timestamp: new Date(),
          improvements: [],
        });

        log.info('Evolution cycle complete', {
          domain,
          cycle: currentCycle + 1,
        });
      }
    );
  }

  /**
   * Get orchestrator status
   */
  static getStatus(): OrchestratorStatus {
    const legalStats = DomainFirewall.getDomainStats(Domain.LEGAL_WHAT);
    const cryptoStats = DomainFirewall.getDomainStats(Domain.CRYPTO_CRAWLER);

    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      activeDomain: DomainFirewall.getCurrentDomain(),
      modelsLoaded: this.models.size,
      totalOperations: this.totalOperations,
      legalwhatStats: {
        operations: legalStats.operationCount,
        errors: legalStats.errorCount,
        evolutionCycles: this.evolutionCycles.get(Domain.LEGAL_WHAT) || 0,
        lastActivity: legalStats.lastActivity,
        activeSubAgents: this.subAgents.get(Domain.LEGAL_WHAT)?.length || 0,
        workerFunctions: this.workerFunctions.get(Domain.LEGAL_WHAT)?.length || 0,
      },
      cryptocrawlerStats: {
        operations: cryptoStats.operationCount,
        errors: cryptoStats.errorCount,
        evolutionCycles: this.evolutionCycles.get(Domain.CRYPTO_CRAWLER) || 0,
        lastActivity: cryptoStats.lastActivity,
        activeSubAgents: this.subAgents.get(Domain.CRYPTO_CRAWLER)?.length || 0,
        workerFunctions: this.workerFunctions.get(Domain.CRYPTO_CRAWLER)?.length || 0,
      },
      systemHealth: this.calculateSystemHealth(),
    };
  }

  /**
   * Calculate overall system health
   */
  private static calculateSystemHealth(): number {
    let health = 100;

    // Check domain isolation
    const isolation = DomainFirewall.verifyIsolation();
    if (!isolation.isIsolated) {
      health -= 30;
    }
    if (isolation.violations > 0) {
      health -= Math.min(20, isolation.violations * 5);
    }

    // Check for errors
    const legalStats = DomainFirewall.getDomainStats(Domain.LEGAL_WHAT);
    const cryptoStats = DomainFirewall.getDomainStats(Domain.CRYPTO_CRAWLER);
    
    health -= Math.min(20, (legalStats.unresolvedErrors + cryptoStats.unresolvedErrors) * 5);

    return Math.max(0, Math.min(100, health));
  }

  /**
   * Stop the orchestrator
   */
  static stop(): void {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping 4JI Orchestrator...');
    this.isRunning = false;
    log.info('4JI Orchestrator stopped');
  }

  /**
   * Reset the orchestrator (for testing)
   */
  static reset(): void {
    this.stop();
    this.models.clear();
    this.subAgents.clear();
    this.workerFunctions.clear();
    this.evolutionCycles.clear();
    this.isInitialized = false;
    this.totalOperations = 0;
    this.startTime = 0;
    DomainFirewall.reset();
    log.info('4JI Orchestrator reset');
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private static ensureRunning(): void {
    if (!this.isRunning) {
      throw new Error('4JI Orchestrator is not running. Call start() first.');
    }
  }
}

export default ForgeAI;
