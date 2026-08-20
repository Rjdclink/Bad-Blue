/**
 * 4JI Sub-Agent Coordinator
 * 
 * Manages all sub-agents with:
 * - Unique identifier assignment
 * - Access to all operational modules
 * - Full authorization for code execution, research, and optimizations
 * - Autonomous operation within domain constraints
 * 
 * SUB-AGENT TYPES:
 * - Legal Domain: Research, Drafting, Filing, Evidence Analysis, SEO
 * - Crypto Domain: Market Analysis, Trading, Arbitrage, Gas Optimization
 * - Shared: Error Detection, Self-Repair, Performance Monitoring
 */

import { createLogger } from '../../logger';
import { Domain, DomainFirewall } from './domain-firewall';
import { CreativePromptEngine, CREATIVE_IGNITION_PROMPT } from './creative-prompt-engine';
import { generateAutonomousText } from '../../aiProvider';
import { TaskPriority } from '../../aiTokenGovernor';

const log = createLogger('4JI-SubAgentCoordinator');

/**
 * Sub-agent authorization levels
 */
export enum AuthorizationLevel {
  FULL = 'full',           // Can execute any operation
  SUPERVISED = 'supervised', // Requires approval for critical operations
  READ_ONLY = 'read-only',   // Can only read and analyze
}

/**
 * Sub-agent capabilities
 */
export type SubAgentCapability = 
  | 'code-execution'
  | 'research'
  | 'optimization'
  | 'analysis'
  | 'generation'
  | 'verification'
  | 'monitoring'
  | 'trading'
  | 'filing'
  | 'communication';

/**
 * Sub-agent configuration
 */
export interface SubAgentConfig {
  id: string;
  name: string;
  domain: Domain;
  capabilities: SubAgentCapability[];
  authorization: AuthorizationLevel;
  creativePromptEnabled: boolean;
  autonomousMode: boolean;
  maxConcurrentTasks: number;
  operationalModules: string[];
}

/**
 * Sub-agent status
 */
export interface SubAgentStatus {
  id: string;
  name: string;
  isActive: boolean;
  currentTask: string | null;
  tasksCompleted: number;
  tasksQueued: number;
  lastActivity: Date | null;
  healthScore: number;
}

/**
 * Task assignment for sub-agents
 */
export interface SubAgentTask {
  id: string;
  agentId: string;
  type: string;
  priority: number;
  payload: unknown;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
}

/**
 * Sub-Agent Coordinator - Manages all operational sub-agents
 */
export class SubAgentCoordinator {
  private static isInitialized = false;
  private static agents: Map<string, SubAgentConfig> = new Map();
  private static agentStatus: Map<string, SubAgentStatus> = new Map();
  private static taskQueue: Map<string, SubAgentTask[]> = new Map();
  private static taskHistory: SubAgentTask[] = [];

  /**
   * Initialize the sub-agent coordinator
   */
  static initialize(): void {
    if (this.isInitialized) {
      return;
    }

    log.info('🤖 Initializing Sub-Agent Coordinator...');

    // Register all sub-agents
    this.registerSubAgents();

    this.isInitialized = true;

    log.info('✅ Sub-Agent Coordinator initialized', {
      totalAgents: this.agents.size,
      legalAgents: Array.from(this.agents.values()).filter(a => a.domain === Domain.LEGAL_WHAT).length,
      cryptoAgents: Array.from(this.agents.values()).filter(a => a.domain === Domain.CRYPTO_CRAWLER).length,
    });
  }

  /**
   * Register all sub-agents with unique identifiers
   */
  private static registerSubAgents(): void {
    // Legal Domain Sub-Agents
    const legalAgents: SubAgentConfig[] = [
      {
        id: '4JI-LEGAL-RESEARCH-001',
        name: 'Legal Research Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['research', 'analysis', 'verification'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 5,
        operationalModules: ['legalSearch', 'precedentFinder', 'caseAnalyzer'],
      },
      {
        id: '4JI-LEGAL-DRAFT-002',
        name: 'Document Drafting Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['generation', 'analysis', 'verification'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 3,
        operationalModules: ['documentGenerator', 'templateEngine', 'legalFormatter'],
      },
      {
        id: '4JI-LEGAL-EVIDENCE-003',
        name: 'Evidence Analysis Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['analysis', 'verification', 'research'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 4,
        operationalModules: ['evidenceProcessor', 'factChecker', 'timelineBuilder'],
      },
      {
        id: '4JI-LEGAL-FILING-004',
        name: 'Legal Filing Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['filing', 'generation', 'verification'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 2,
        operationalModules: ['filingSystem', 'courtIntegration', 'deadlineTracker'],
      },
      {
        id: '4JI-LEGAL-CLIENT-005',
        name: 'Client Communication Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['communication', 'analysis', 'generation'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 10,
        operationalModules: ['alexaraVoice', 'chatInterface', 'emailService'],
      },
      {
        id: '4JI-LEGAL-UX-006',
        name: 'UX Optimization Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['optimization', 'analysis', 'monitoring'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 3,
        operationalModules: ['uxAnalyzer', 'a11yChecker', 'performanceMonitor'],
      },
      {
        id: '4JI-LEGAL-SEO-007',
        name: 'SEO Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['optimization', 'research', 'monitoring'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 2,
        operationalModules: ['seoAnalyzer', 'keywordResearch', 'rankingTracker'],
      },
      {
        id: '4JI-LEGAL-CONSULT-008',
        name: 'Legal Consultation Agent',
        domain: Domain.LEGAL_WHAT,
        capabilities: ['analysis', 'communication', 'generation'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 8,
        operationalModules: ['consultationEngine', 'legalExpertSystem', 'lawExpertise'],
      },
    ];

    // Crypto Domain Sub-Agents
    const cryptoAgents: SubAgentConfig[] = [
      {
        id: '4JI-CRYPTO-MARKET-001',
        name: 'Market Analysis Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['analysis', 'monitoring', 'research'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 10,
        operationalModules: ['marketScanner', 'priceOracle', 'volumeAnalyzer'],
      },
      {
        id: '4JI-CRYPTO-TRADE-002',
        name: 'Trading Execution Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['trading', 'analysis', 'monitoring'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 5,
        operationalModules: ['orderExecutor', 'positionManager', 'slippageOptimizer'],
      },
      {
        id: '4JI-CRYPTO-ARB-003',
        name: 'Arbitrage Detection Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['analysis', 'trading', 'monitoring'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 8,
        operationalModules: ['arbScanner', 'dexAggregator', 'profitCalculator'],
      },
      {
        id: '4JI-CRYPTO-RISK-004',
        name: 'Risk Assessment Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['analysis', 'verification', 'monitoring'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 4,
        operationalModules: ['riskEngine', 'exposureMonitor', 'circuitBreaker'],
      },
      {
        id: '4JI-CRYPTO-CHAIN-005',
        name: 'Blockchain Monitoring Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['monitoring', 'analysis', 'research'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 15,
        operationalModules: ['chainListener', 'mempoolMonitor', 'blockAnalyzer'],
      },
      {
        id: '4JI-CRYPTO-GAS-006',
        name: 'Gas Optimization Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['optimization', 'monitoring', 'analysis'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 3,
        operationalModules: ['gasOptimizer', 'noncManager', 'txBundler'],
      },
      {
        id: '4JI-CRYPTO-FAUCET-007',
        name: 'Faucet Controller Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['monitoring', 'code-execution', 'optimization'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 2,
        operationalModules: ['faucetManager', 'balanceMonitor', 'distributionEngine'],
      },
      {
        id: '4JI-CRYPTO-MONTE-008',
        name: 'Monte Carlo Simulation Agent',
        domain: Domain.CRYPTO_CRAWLER,
        capabilities: ['analysis', 'research', 'optimization'],
        authorization: AuthorizationLevel.FULL,
        creativePromptEnabled: true,
        autonomousMode: true,
        maxConcurrentTasks: 2,
        operationalModules: ['monteCarloEngine', 'strategyValidator', 'riskSimulator'],
      },
    ];

    // Register all agents
    [...legalAgents, ...cryptoAgents].forEach(agent => {
      this.agents.set(agent.id, agent);
      this.agentStatus.set(agent.id, {
        id: agent.id,
        name: agent.name,
        isActive: true,
        currentTask: null,
        tasksCompleted: 0,
        tasksQueued: 0,
        lastActivity: null,
        healthScore: 100,
      });
      this.taskQueue.set(agent.id, []);
    });

    log.info('Sub-agents registered', {
      legal: legalAgents.length,
      crypto: cryptoAgents.length,
    });
  }

  /**
   * Get agent by ID
   */
  static getAgent(agentId: string): SubAgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents for a domain
   */
  static getAgentsByDomain(domain: Domain): SubAgentConfig[] {
    return Array.from(this.agents.values()).filter(a => a.domain === domain);
  }

  /**
   * Get agent status
   */
  static getAgentStatus(agentId: string): SubAgentStatus | undefined {
    return this.agentStatus.get(agentId);
  }

  /**
   * Get all agent statuses
   */
  static getAllAgentStatuses(): SubAgentStatus[] {
    return Array.from(this.agentStatus.values());
  }

  /**
   * Assign task to agent
   */
  static async assignTask(
    agentId: string,
    taskType: string,
    payload: unknown,
    priority: number = 5
  ): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const task: SubAgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      agentId,
      type: taskType,
      priority,
      payload,
      createdAt: new Date(),
    };

    const queue = this.taskQueue.get(agentId) || [];
    queue.push(task);
    this.taskQueue.set(agentId, queue);

    // Update status
    const status = this.agentStatus.get(agentId);
    if (status) {
      status.tasksQueued = queue.length;
    }

    log.debug('Task assigned to agent', {
      agentId,
      taskId: task.id,
      type: taskType,
    });

    // Execute task asynchronously
    this.executeAgentTask(agentId, task).catch(err => {
      log.error('Task execution failed', {
        agentId,
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return task.id;
  }

  /**
   * Execute agent task
   */
  private static async executeAgentTask(agentId: string, task: SubAgentTask): Promise<void> {
    const agent = this.agents.get(agentId);
    const status = this.agentStatus.get(agentId);
    
    if (!agent || !status) {
      return;
    }

    task.startedAt = new Date();
    status.currentTask = task.id;

    try {
      // Execute within isolated domain
      await DomainFirewall.executeInDomain(
        agent.domain,
        `agent:${agentId}:${task.type}`,
        async () => {
          // Apply creative prompt if enabled
          let enhancedPayload = task.payload;
          if (agent.creativePromptEnabled && typeof task.payload === 'string') {
            enhancedPayload = CreativePromptEngine.enhancePrompt(task.payload);
          }

          log.debug('Agent executing task', {
            agentId,
            taskId: task.id,
            modules: agent.operationalModules,
          });

          const payload = typeof enhancedPayload === 'string'
            ? enhancedPayload
            : JSON.stringify(enhancedPayload);
          const response = await generateAutonomousText(
            `4ji-${agent.id}-${task.type}`,
            `You are the ${agent.name}. Complete the assigned ${task.type} task using your capabilities: ${agent.capabilities.join(', ')}.\n\nTask payload:\n${payload}`,
            { temperature: agent.creativePromptEnabled ? 0.7 : 0.3 },
            task.priority >= 8 ? TaskPriority.MEDIUM_BACKGROUND : TaskPriority.LOW_BACKGROUND
          );

          task.result = {
            status: 'completed',
            agentId,
            taskType: task.type,
            content: response.content,
            provider: response.provider,
            tokensUsed: response.tokensUsed,
            processedAt: new Date(),
          };
        }
      );

      task.completedAt = new Date();
      status.tasksCompleted++;
      status.lastActivity = new Date();

      // Remove from queue
      const queue = this.taskQueue.get(agentId) || [];
      const taskIndex = queue.findIndex(t => t.id === task.id);
      if (taskIndex >= 0) {
        queue.splice(taskIndex, 1);
      }
      status.tasksQueued = queue.length;

      log.debug('Agent task completed', {
        agentId,
        taskId: task.id,
        durationMs: task.completedAt.getTime() - (task.startedAt?.getTime() || 0),
      });

    } catch (error) {
      task.error = error instanceof Error ? error.message : String(error);
      log.error('Agent task failed', {
        agentId,
        taskId: task.id,
        error: task.error,
      });
    } finally {
      status.currentTask = null;
      this.taskHistory.push(task);
    }
  }

  /**
   * Get task history
   */
  static getTaskHistory(limit: number = 100): SubAgentTask[] {
    return this.taskHistory.slice(-limit);
  }

  /**
   * Verify all agents have unique identifiers and full access
   */
  static verifyAgentConfiguration(): {
    valid: boolean;
    issues: string[];
    agentSummary: { id: string; domain: string; capabilities: number; modules: number }[];
  } {
    const issues: string[] = [];
    const ids = new Set<string>();

    for (const agent of this.agents.values()) {
      // Check unique ID
      if (ids.has(agent.id)) {
        issues.push(`Duplicate agent ID: ${agent.id}`);
      }
      ids.add(agent.id);

      // Check authorization
      if (agent.authorization !== AuthorizationLevel.FULL) {
        issues.push(`Agent ${agent.id} does not have full authorization`);
      }

      // Check capabilities
      if (agent.capabilities.length === 0) {
        issues.push(`Agent ${agent.id} has no capabilities defined`);
      }

      // Check operational modules
      if (agent.operationalModules.length === 0) {
        issues.push(`Agent ${agent.id} has no operational modules`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      agentSummary: Array.from(this.agents.values()).map(a => ({
        id: a.id,
        domain: a.domain,
        capabilities: a.capabilities.length,
        modules: a.operationalModules.length,
      })),
    };
  }

  /**
   * Reset the coordinator (for testing)
   */
  static reset(): void {
    this.agents.clear();
    this.agentStatus.clear();
    this.taskQueue.clear();
    this.taskHistory = [];
    this.isInitialized = false;
    log.info('Sub-Agent Coordinator reset');
  }
}

export default SubAgentCoordinator;
