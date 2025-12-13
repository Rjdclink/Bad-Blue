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
import { AIProvider, TaskPriority, UsageContext } from '../../aiTokenGovernor';

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

/**
 * Task definition for orchestrated execution
 */
export interface OrchestratedTask {
  id: string;
  domain: Domain;
  type: string;
  priority: TaskPriority;
  requiredCapabilities: AICapability[];
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
        id: 'claude-4.5-opus',
        name: 'Claude 4.5 Opus',
        provider: AIProvider.CLAUDE_OPUS,
        capabilities: ['reasoning', 'legal-analysis', 'creative-writing', 'orchestration', 'long-context'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 16384,
        costTier: 'premium',
        speedTier: 'slow',
        contextWindow: 200000,
      },
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: AIProvider.CLAUDE,
        capabilities: ['reasoning', 'legal-analysis', 'document-generation', 'verification'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'high',
        speedTier: 'medium',
        contextWindow: 200000,
      },
      {
        id: 'claude-3.5-haiku',
        name: 'Claude 3.5 Haiku',
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
        id: 'llama-3.3-70b',
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
        id: 'llama-3.1-8b',
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
        id: 'mistral-large',
        name: 'Mistral Large Latest',
        provider: AIProvider.MISTRAL,
        capabilities: ['reasoning', 'coding', 'legal-analysis'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 32768,
        costTier: 'medium',
        speedTier: 'medium',
        contextWindow: 128000,
      },
      {
        id: 'mistral-small',
        name: 'Mistral Small Latest',
        provider: AIProvider.MISTRAL,
        capabilities: ['fast-inference', 'data-extraction', 'verification'],
        domains: [Domain.LEGAL_WHAT, Domain.CRYPTO_CRAWLER],
        maxTokens: 8192,
        costTier: 'low',
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
        id: 'trading-ai',
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
          // Select optimal models for this task
          const selectedModels = this.selectModelsForTask(task);
          
          // Track in domain context
          DomainFirewall.storeState(task.domain, `lastTask:${task.id}`, {
            type: task.type,
            timestamp: new Date(),
          });

          // Simulated execution (would call actual AI providers)
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

    // Use primary model for now (could implement parallel execution)
    const primaryModel = models[0];

    // Placeholder - actual implementation would call the AI provider
    log.debug('Executing with model', {
      taskId: task.id,
      model: primaryModel.id,
    });

    return {
      content: `[4JI Orchestrated Response: ${task.type} via ${primaryModel.name}]`,
      modelsUsed: [primaryModel.id],
      tokensUsed: 0,
      confidence: 0.95,
    };
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
