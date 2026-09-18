/**
 * 4JI (Forge AI) - Unified Master Orchestrator
 * 
 * ARCHITECTURE:
 * - Single decision-making intelligence coordinating all AI models
 * - Split operational domains: LegalWhat vs Crypto Crawler
 * - Strict separation with no cross-domain control
 * - Shared optimized infrastructure, isolated execution
 * 
 * AI MODEL INTEGRATION: current Harmony generations
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
import { AICollaborationOrchestrator } from '../../aiCollaborationOrchestrator';
import { TaskComplexity as SelectorTaskComplexity, TaskPriority as SelectorTaskPriority } from '../../aiModelSelector';
import { deepSeekSearch, grokSearch, kimiSearch, qwenSearch } from '../../openRouterService';
import { CURRENT_AI_MODELS, getConfiguredHarmonyProviders } from '../../aiHarmonyModelRegistry';

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
        id: CURRENT_AI_MODELS.gemini,
        name: 'Gemini 3.8 Flash',
        provider: AIProvider.GEMINI,
        capabilities: ['reasoning', 'visual-analysis', 'long-context', 'research', 'orchestration'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 32768,
        costTier: 'medium',
        speedTier: 'medium',
        contextWindow: 1000000,
      },
      {
        id: CURRENT_AI_MODELS.gemini,
        name: 'Gemini 3.8 Flash',
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
        id: CURRENT_AI_MODELS.claudeDeep,
        name: 'Claude Opus 5',
        provider: AIProvider.CLAUDE_OPUS,
        capabilities: ['reasoning', 'legal-analysis', 'creative-writing', 'orchestration', 'long-context'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 16384,
        costTier: 'premium',
        speedTier: 'slow',
        contextWindow: 200000,
      },
      {
        id: CURRENT_AI_MODELS.claudeBalanced,
        name: 'Claude Sonnet 5',
        provider: AIProvider.CLAUDE,
        capabilities: ['reasoning', 'legal-analysis', 'document-generation', 'verification'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'high',
        speedTier: 'medium',
        contextWindow: 200000,
      },
      {
        id: CURRENT_AI_MODELS.claudeFast,
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
        id: CURRENT_AI_MODELS.groqDeep,
        name: 'GPT-OSS 120B on Groq',
        provider: AIProvider.GROQ,
        capabilities: ['reasoning', 'coding', 'fast-inference', 'research'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 32768,
        costTier: 'free',
        speedTier: 'instant',
        contextWindow: 131072,
      },
      {
        id: CURRENT_AI_MODELS.groqFast,
        name: 'GPT-OSS 20B on Groq',
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
        id: CURRENT_AI_MODELS.mistralFast,
        name: 'Mistral Small 4',
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
        id: CURRENT_AI_MODELS.deepseek,
        name: 'DeepSeek V4.1 Flash',
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
        id: CURRENT_AI_MODELS.grok,
        name: 'Grok 4.6',
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
        id: CURRENT_AI_MODELS.kimi,
        name: 'Kimi K3',
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
        id: CURRENT_AI_MODELS.openaiFastViaOpenRouter,
        name: 'GPT-5.6 Luna',
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
        id: CURRENT_AI_MODELS.qwen,
        name: 'Qwen3.8 Max',
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
        id: CURRENT_AI_MODELS.groqDeep,
        name: 'Trading AI Specialist (GPT-OSS 120B)',
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

          // Tie-break only on task-relevant execution characteristics. Provider
          // identity is never a preference signal.
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
    _models: AIModelConfig[]
  ): Promise<{ content: unknown; modelsUsed: string[]; tokensUsed: number; confidence: number }> {
    return this.executeHarmonyTask(task);
  }

  /**
   * Execute task using explicit role assignments and resolve disagreement via reviewer model.
   */
  private static async executeRoleBased(
    task: OrchestratedTask
  ): Promise<{ content: unknown; modelsUsed: string[]; tokensUsed: number; confidence: number }> {
    // Roles contribute task requirements, not hard provider assignments. The
    // shared Harmony mesh resolves the compatible participants dynamically.
    return this.executeHarmonyTask(task);
  }

  private static async executeHarmonyTask(
    task: OrchestratedTask,
  ): Promise<{ content: unknown; modelsUsed: string[]; tokensUsed: number; confidence: number }> {
    const providers = getConfiguredHarmonyProviders();
    if (providers.length === 0) {
      throw new Error('No configured Harmony providers are available for 4JI');
    }

    const required = new Set(task.requiredCapabilities);
    const response = await AICollaborationOrchestrator.orchestrateCollaboration(
      `forge-${task.domain}-${task.type}`,
      task.prompt,
      {
        context: task.priority >= TaskPriority.HIGH_USER ? UsageContext.USER : UsageContext.AUTONOMOUS,
        complexity: required.has('reasoning') || required.has('legal-analysis')
          ? SelectorTaskComplexity.COMPREHENSIVE
          : SelectorTaskComplexity.MODERATE,
        priority: task.priority >= TaskPriority.CRITICAL_USER
          ? SelectorTaskPriority.CRITICAL
          : task.priority >= TaskPriority.HIGH_USER
            ? SelectorTaskPriority.HIGH
            : task.priority >= TaskPriority.MEDIUM_BACKGROUND
              ? SelectorTaskPriority.MEDIUM
              : SelectorTaskPriority.LOW,
        estimatedTokens: task.maxTokens,
        needsReasoning: required.has('reasoning') || required.has('orchestration'),
        needsCodeGeneration: required.has('coding'),
        needsLegalAnalysis: required.has('legal-analysis') || task.domain === Domain.LEGAL_WHAT,
        needsVerification: required.has('verification') || (task.roles || []).includes('review'),
        needsPatternRecognition: required.has('pattern-recognition') || required.has('market-prediction'),
        needsSearchGrounding: required.has('research'),
        needsLongContext: required.has('long-context'),
        needsMultimodal: required.has('visual-analysis'),
        needsDataExtraction: required.has('data-extraction'),
        needsStructuredOutput: required.has('data-extraction'),
        needsFastResponse: required.has('fast-inference'),
      },
      providers,
      {
        providerPolicy: 'capability-first',
        systemPrompt: task.systemPrompt,
      },
    );

    const successes = response.contributions.filter(entry => entry.success);
    if (!response.finalAnswer?.trim() || successes.length === 0) {
      throw new Error(`Harmony produced no usable 4JI result for ${task.id}`);
    }

    return {
      content: response.finalAnswer,
      modelsUsed: Array.from(new Set(successes.map(entry => entry.model))),
      tokensUsed: response.totalTokens,
      confidence: successes.length / Math.max(1, response.contributions.length),
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
