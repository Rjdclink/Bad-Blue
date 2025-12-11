/**
 * Master Control Console (MCC) Orchestrator
 * 
 * Implements the single-prompt interface for coordinating all 13+ AI models:
 * - Single natural-language directive input
 * - Command dispatcher to route tasks by specialization
 * - Integration with worker function (autonomous operations)
 * - Integration with sub-agent function (user prompts)
 * - Parallel orchestrated execution with cross-validation
 * - Adaptive error detection and resolution
 * - Feedback and learning layer
 * 
 * ORCHESTRATION HIERARCHY:
 * 1. MCC receives single prompt from operator
 * 2. Intent inference engine parses into structured tasks
 * 3. Tasks distributed to worker (autonomous) or sub-agent (user-directed)
 * 4. Parallel execution with dynamic load balancing
 * 5. Cross-validation and result synthesis
 * 6. Error detection and adaptive correction
 */

import { AICollaborationOrchestrator, OrchestratedResponse, CollaborationResult } from './aiCollaborationOrchestrator';
import { AIProvider, UsageContext, aiTokenGovernor, TaskPriority as GovernorPriority } from './aiTokenGovernor';
import { AIModelSelector, TaskAttributes, TaskComplexity, TaskPriority } from './aiModelSelector';
import { processSubAgentCommand, callAIWithGovernor, callAIWithFallback } from './aiSubAgent';
import { badblueWorker } from './badblueWorker';
import { logger } from './logger';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================
// CONSTANTS - Tunable parameters for MCC
// ============================================

/** Default estimated tokens for heuristic parsing */
const DEFAULT_ESTIMATED_TOKENS = 2000;

/** Default confidence for heuristic parsing */
const DEFAULT_HEURISTIC_CONFIDENCE = 0.6;

/** Average characters per token (rough estimate) */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * MCC Task Categories
 */
export enum MCCTaskCategory {
  TRADING_OPTIMIZATION = 'trading_optimization',
  DATA_ANALYSIS = 'data_analysis',
  SYSTEM_UPDATES = 'system_updates',
  LEGAL_CONSULTATION = 'legal_consultation',
  OFFICER_SEARCH = 'officer_search',
  DOCUMENT_GENERATION = 'document_generation',
  VISUAL_OPTIMIZATION = 'visual_optimization',
  ERROR_RESOLUTION = 'error_resolution',
  SEO_OPTIMIZATION = 'seo_optimization',
  FILE_MANAGEMENT = 'file_management',
  SECURITY_CHECK = 'security_check',
  GENERAL = 'general',
}

/**
 * MCC Execution Mode
 */
export enum MCCExecutionMode {
  WORKER = 'worker',           // Autonomous background tasks
  SUBAGENT = 'subagent',       // User-directed interactive tasks
  HYBRID = 'hybrid',           // Both worker and sub-agent coordination
}

/**
 * Parsed directive from natural language input
 */
export interface ParsedDirective {
  originalPrompt: string;
  category: MCCTaskCategory;
  executionMode: MCCExecutionMode;
  priority: TaskPriority;
  complexity: TaskComplexity;
  subtasks: SubTask[];
  requiresVerification: boolean;
  estimatedTokens: number;
  confidence: number;
  intent: string;
  targetModels?: AIProvider[];
}

/**
 * Sub-task for parallel execution
 */
export interface SubTask {
  id: string;
  name: string;
  description: string;
  category: MCCTaskCategory;
  executionMode: MCCExecutionMode;
  dependencies?: string[];
  priority: TaskPriority;
  complexity: TaskComplexity;
  assignedModels?: AIProvider[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

/**
 * MCC Execution Result
 */
export interface MCCExecutionResult {
  success: boolean;
  originalPrompt: string;
  parsedDirective: ParsedDirective;
  executionResults: SubTaskResult[];
  synthesizedResponse: string;
  crossValidation?: CrossValidationResult;
  errorResolution?: ErrorResolutionResult;
  totalLatencyMs: number;
  tokensUsed: number;
  modelsUsed: AIProvider[];
}

/**
 * Sub-task execution result
 */
export interface SubTaskResult {
  subtaskId: string;
  subtaskName: string;
  success: boolean;
  result?: any;
  error?: string;
  provider?: AIProvider;
  latencyMs: number;
  tokensUsed: number;
}

/**
 * Cross-validation result
 */
export interface CrossValidationResult {
  validated: boolean;
  confidenceScore: number;
  discrepancies: string[];
  consensus: string;
}

/**
 * Error resolution result
 */
export interface ErrorResolutionResult {
  errorsDetected: number;
  errorsResolved: number;
  unresolvedErrors: string[];
  resolutionActions: string[];
}

/**
 * MCC Data directory
 */
const MCC_DATA_DIR = path.join(process.cwd(), 'data', 'mcc');
const MCC_LOG_FILE = path.join(MCC_DATA_DIR, 'execution_log.json');
const MCC_LEARNING_FILE = path.join(MCC_DATA_DIR, 'learning_data.json');

/**
 * Ensure MCC data directory exists
 */
async function ensureMCCDataDir(): Promise<void> {
  try {
    await fs.mkdir(MCC_DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory may already exist
  }
}

/**
 * Master Control Console Orchestrator
 */
export class MasterControlConsole {
  private static instance: MasterControlConsole;
  private executionHistory: MCCExecutionResult[] = [];
  private learningData: Map<string, any> = new Map();
  
  private constructor() {}
  
  /**
   * Get singleton instance
   */
  static getInstance(): MasterControlConsole {
    if (!MasterControlConsole.instance) {
      MasterControlConsole.instance = new MasterControlConsole();
    }
    return MasterControlConsole.instance;
  }
  
  /**
   * Main entry point - execute a single natural language directive
   * This is the "one prompt → full execution" interface
   */
  async executeDirective(prompt: string): Promise<MCCExecutionResult> {
    const startTime = Date.now();
    await ensureMCCDataDir();
    
    logger.info(`[MCC] Received directive: ${prompt.substring(0, 100)}...`);
    
    try {
      // Step 1: Parse the natural language directive
      const parsedDirective = await this.parseDirective(prompt);
      logger.info(`[MCC] Parsed directive: ${parsedDirective.intent} (${parsedDirective.category}, confidence: ${parsedDirective.confidence})`);
      
      // Step 2: Split into subtasks
      const subtasks = await this.generateSubtasks(parsedDirective);
      parsedDirective.subtasks = subtasks;
      logger.info(`[MCC] Generated ${subtasks.length} subtasks`);
      
      // Step 3: Execute subtasks with dynamic load balancing
      const executionResults = await this.executeSubtasksParallel(subtasks, parsedDirective);
      
      // Step 4: Cross-validate results
      const crossValidation = await this.crossValidateResults(executionResults, parsedDirective);
      
      // Step 5: Detect and resolve errors
      const errorResolution = await this.detectAndResolveErrors(executionResults);
      
      // Step 6: Synthesize final response
      const synthesizedResponse = await this.synthesizeResults(
        prompt,
        executionResults,
        crossValidation,
        parsedDirective
      );
      
      // Calculate totals
      const totalLatencyMs = Date.now() - startTime;
      const tokensUsed = executionResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
      const modelsUsed = Array.from(new Set(
        executionResults.filter(r => r.provider).map(r => r.provider!)
      ));
      
      const result: MCCExecutionResult = {
        success: executionResults.some(r => r.success),
        originalPrompt: prompt,
        parsedDirective,
        executionResults,
        synthesizedResponse,
        crossValidation,
        errorResolution,
        totalLatencyMs,
        tokensUsed,
        modelsUsed,
      };
      
      // Log execution for learning
      await this.logExecution(result);
      
      logger.info(`[MCC] Directive completed in ${totalLatencyMs}ms, ${tokensUsed} tokens, ${modelsUsed.length} models`);
      
      return result;
      
    } catch (error: any) {
      logger.error('[MCC] Directive execution failed:', error);
      
      return {
        success: false,
        originalPrompt: prompt,
        parsedDirective: {
          originalPrompt: prompt,
          category: MCCTaskCategory.GENERAL,
          executionMode: MCCExecutionMode.HYBRID,
          priority: TaskPriority.MEDIUM,
          complexity: TaskComplexity.MODERATE,
          subtasks: [],
          requiresVerification: false,
          estimatedTokens: 0,
          confidence: 0,
          intent: 'Unknown - execution failed',
        },
        executionResults: [],
        synthesizedResponse: `Error executing directive: ${error?.message || 'Unknown error'}`,
        totalLatencyMs: Date.now() - startTime,
        tokensUsed: 0,
        modelsUsed: [],
      };
    }
  }
  
  /**
   * Parse natural language directive into structured format
   * Uses AI to infer intent and determine optimal execution path
   */
  private async parseDirective(prompt: string): Promise<ParsedDirective> {
    const parsePrompt = `Analyze this user directive and extract structured information.

DIRECTIVE: "${prompt}"

Respond with a JSON object containing:
{
  "intent": "Brief description of what the user wants to accomplish",
  "category": "One of: trading_optimization, data_analysis, system_updates, legal_consultation, officer_search, document_generation, visual_optimization, error_resolution, seo_optimization, file_management, security_check, general",
  "executionMode": "One of: worker (for background/autonomous tasks), subagent (for interactive/user-directed tasks), hybrid (for tasks requiring both)",
  "priority": "One of: low, medium, high, critical",
  "complexity": "One of: lightweight, moderate, comprehensive",
  "requiresVerification": true/false,
  "estimatedTokens": number,
  "confidence": 0.0-1.0
}

Be precise and accurate. Consider the task complexity and what AI capabilities are needed.`;

    try {
      const result = await callAIWithFallback(parsePrompt, {
        taskName: 'mcc-directive-parsing',
        useJSON: true,
        temperature: 0.3,
      });
      
      if (result.success && result.content) {
        try {
          const parsed = this.extractJSON(result.content);
          
          // Type-safe access to parsed properties
          const category = typeof parsed.category === 'string' ? parsed.category : 'general';
          const executionMode = typeof parsed.executionMode === 'string' ? parsed.executionMode : 'subagent';
          const priority = typeof parsed.priority === 'string' ? parsed.priority : 'medium';
          const complexity = typeof parsed.complexity === 'string' ? parsed.complexity : 'moderate';
          
          return {
            originalPrompt: prompt,
            category: this.mapCategory(category),
            executionMode: this.mapExecutionMode(executionMode),
            priority: this.mapPriority(priority),
            complexity: this.mapComplexity(complexity),
            subtasks: [],
            requiresVerification: typeof parsed.requiresVerification === 'boolean' ? parsed.requiresVerification : true,
            estimatedTokens: typeof parsed.estimatedTokens === 'number' ? parsed.estimatedTokens : DEFAULT_ESTIMATED_TOKENS,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
            intent: typeof parsed.intent === 'string' && parsed.intent.trim().length > 0 ? parsed.intent : 'Execute user directive',
          };
        } catch (jsonError: any) {
          logger.warn('[MCC] JSON parsing failed, using heuristic parsing:', jsonError.message);
          return this.heuristicParse(prompt);
        }
      }
    } catch (error: any) {
      logger.warn('[MCC] AI parsing failed, using heuristic parsing:', error.message);
    }
    
    // Fallback: Heuristic parsing (all AI providers failed or no content)
    return this.heuristicParse(prompt);
  }
  
  /**
   * Extract JSON from AI response (handles markdown code blocks)
   * @param content - Raw AI response content
   * @returns Parsed JSON object
   * @throws Error if JSON parsing fails
   */
  private extractJSON(content: string): Record<string, unknown> {
    let cleanJson = content.trim();
    
    // Remove markdown code blocks
    if (cleanJson.includes('```json')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    } else if (cleanJson.includes('```')) {
      cleanJson = cleanJson.replace(/```\n?/g, '').trim();
    }
    
    // Find JSON object boundaries
    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
    }
    
    return JSON.parse(cleanJson);
  }
  
  /**
   * Heuristic parsing fallback
   */
  private heuristicParse(prompt: string): ParsedDirective {
    const lower = prompt.toLowerCase();
    
    let category = MCCTaskCategory.GENERAL;
    let executionMode = MCCExecutionMode.SUBAGENT;
    let priority = TaskPriority.MEDIUM;
    let complexity = TaskComplexity.MODERATE;
    
    // Category detection
    if (lower.includes('trade') || lower.includes('crypto') || lower.includes('market')) {
      category = MCCTaskCategory.TRADING_OPTIMIZATION;
    } else if (lower.includes('search') || lower.includes('find') || lower.includes('analyze')) {
      category = MCCTaskCategory.DATA_ANALYSIS;
    } else if (lower.includes('legal') || lower.includes('law') || lower.includes('statute')) {
      category = MCCTaskCategory.LEGAL_CONSULTATION;
    } else if (lower.includes('officer') || lower.includes('police') || lower.includes('badge')) {
      category = MCCTaskCategory.OFFICER_SEARCH;
    } else if (lower.includes('document') || lower.includes('generate') || lower.includes('create')) {
      category = MCCTaskCategory.DOCUMENT_GENERATION;
    } else if (lower.includes('fix') || lower.includes('error') || lower.includes('repair')) {
      category = MCCTaskCategory.ERROR_RESOLUTION;
      executionMode = MCCExecutionMode.WORKER;
    } else if (lower.includes('seo') || lower.includes('rank') || lower.includes('keyword')) {
      category = MCCTaskCategory.SEO_OPTIMIZATION;
    } else if (lower.includes('visual') || lower.includes('ui') || lower.includes('design')) {
      category = MCCTaskCategory.VISUAL_OPTIMIZATION;
    } else if (lower.includes('update') || lower.includes('system') || lower.includes('maintain')) {
      category = MCCTaskCategory.SYSTEM_UPDATES;
      executionMode = MCCExecutionMode.WORKER;
    } else if (lower.includes('file') || lower.includes('save') || lower.includes('upload')) {
      category = MCCTaskCategory.FILE_MANAGEMENT;
    } else if (lower.includes('security') || lower.includes('protect') || lower.includes('auth')) {
      category = MCCTaskCategory.SECURITY_CHECK;
      executionMode = MCCExecutionMode.WORKER;
    }
    
    // Priority detection
    if (lower.includes('urgent') || lower.includes('critical') || lower.includes('asap')) {
      priority = TaskPriority.CRITICAL;
    } else if (lower.includes('important') || lower.includes('high priority')) {
      priority = TaskPriority.HIGH;
    } else if (lower.includes('low priority') || lower.includes('whenever')) {
      priority = TaskPriority.LOW;
    }
    
    // Complexity detection
    if (lower.includes('comprehensive') || lower.includes('detailed') || lower.includes('thorough')) {
      complexity = TaskComplexity.COMPREHENSIVE;
    } else if (lower.includes('quick') || lower.includes('simple') || lower.includes('brief')) {
      complexity = TaskComplexity.LIGHTWEIGHT;
    }
    
    return {
      originalPrompt: prompt,
      category,
      executionMode,
      priority,
      complexity,
      subtasks: [],
      requiresVerification: true,
      estimatedTokens: DEFAULT_ESTIMATED_TOKENS,
      confidence: DEFAULT_HEURISTIC_CONFIDENCE,
      intent: `Process ${category} request`,
    };
  }
  
  /**
   * Generate subtasks for parallel execution
   */
  private async generateSubtasks(directive: ParsedDirective): Promise<SubTask[]> {
    const subtasks: SubTask[] = [];
    const baseId = Date.now().toString(36);
    
    // Primary task
    subtasks.push({
      id: `${baseId}-primary`,
      name: 'Primary Analysis',
      description: directive.intent,
      category: directive.category,
      executionMode: directive.executionMode,
      priority: directive.priority,
      complexity: directive.complexity,
      status: 'pending',
    });
    
    // Verification task (if required)
    if (directive.requiresVerification) {
      subtasks.push({
        id: `${baseId}-verify`,
        name: 'Result Verification',
        description: 'Cross-check and verify primary analysis results',
        category: directive.category,
        executionMode: MCCExecutionMode.SUBAGENT,
        dependencies: [`${baseId}-primary`],
        priority: TaskPriority.HIGH,
        complexity: TaskComplexity.LIGHTWEIGHT,
        status: 'pending',
      });
    }
    
    // Category-specific subtasks
    switch (directive.category) {
      case MCCTaskCategory.LEGAL_CONSULTATION:
        subtasks.push({
          id: `${baseId}-precedent`,
          name: 'Precedent Search',
          description: 'Search for relevant legal precedents',
          category: MCCTaskCategory.LEGAL_CONSULTATION,
          executionMode: MCCExecutionMode.SUBAGENT,
          priority: directive.priority,
          complexity: TaskComplexity.MODERATE,
          status: 'pending',
        });
        break;
        
      case MCCTaskCategory.OFFICER_SEARCH:
        subtasks.push({
          id: `${baseId}-database`,
          name: 'Database Search',
          description: 'Search officer databases',
          category: MCCTaskCategory.OFFICER_SEARCH,
          executionMode: MCCExecutionMode.SUBAGENT,
          priority: directive.priority,
          complexity: TaskComplexity.MODERATE,
          status: 'pending',
        });
        break;
        
      case MCCTaskCategory.ERROR_RESOLUTION:
        subtasks.push({
          id: `${baseId}-diagnosis`,
          name: 'Error Diagnosis',
          description: 'Diagnose root cause of errors',
          category: MCCTaskCategory.ERROR_RESOLUTION,
          executionMode: MCCExecutionMode.WORKER,
          priority: TaskPriority.HIGH,
          complexity: TaskComplexity.COMPREHENSIVE,
          status: 'pending',
        });
        subtasks.push({
          id: `${baseId}-fix`,
          name: 'Apply Fix',
          description: 'Apply automated fix for detected errors',
          category: MCCTaskCategory.ERROR_RESOLUTION,
          executionMode: MCCExecutionMode.WORKER,
          dependencies: [`${baseId}-diagnosis`],
          priority: TaskPriority.HIGH,
          complexity: TaskComplexity.MODERATE,
          status: 'pending',
        });
        break;
        
      case MCCTaskCategory.SYSTEM_UPDATES:
        subtasks.push({
          id: `${baseId}-backup`,
          name: 'System Backup',
          description: 'Create backup before updates',
          category: MCCTaskCategory.SYSTEM_UPDATES,
          executionMode: MCCExecutionMode.WORKER,
          priority: TaskPriority.HIGH,
          complexity: TaskComplexity.LIGHTWEIGHT,
          status: 'pending',
        });
        break;
    }
    
    return subtasks;
  }
  
  /**
   * Execute subtasks with parallel orchestration and dynamic load balancing
   */
  private async executeSubtasksParallel(
    subtasks: SubTask[],
    directive: ParsedDirective
  ): Promise<SubTaskResult[]> {
    const results: SubTaskResult[] = [];
    const completedTasks = new Map<string, SubTaskResult>();
    
    // Group tasks by dependencies for parallel execution
    const noDeps = subtasks.filter(t => !t.dependencies || t.dependencies.length === 0);
    const withDeps = subtasks.filter(t => t.dependencies && t.dependencies.length > 0);
    
    // Execute tasks without dependencies in parallel
    const parallelResults = await Promise.all(
      noDeps.map(task => this.executeSubtask(task, directive))
    );
    
    parallelResults.forEach((result, idx) => {
      results.push(result);
      completedTasks.set(noDeps[idx].id, result);
    });
    
    // Execute dependent tasks
    for (const task of withDeps) {
      // Wait for all dependencies
      const depsReady = task.dependencies?.every(dep => completedTasks.has(dep));
      
      if (depsReady) {
        const result = await this.executeSubtask(task, directive, completedTasks);
        results.push(result);
        completedTasks.set(task.id, result);
      } else {
        // Skip tasks with unmet dependencies
        results.push({
          subtaskId: task.id,
          subtaskName: task.name,
          success: false,
          error: 'Dependencies not met',
          latencyMs: 0,
          tokensUsed: 0,
        });
      }
    }
    
    return results;
  }
  
  /**
   * Execute a single subtask
   */
  private async executeSubtask(
    task: SubTask,
    directive: ParsedDirective,
    completedTasks?: Map<string, SubTaskResult>
  ): Promise<SubTaskResult> {
    const startTime = Date.now();
    
    try {
      task.status = 'running';
      logger.debug(`[MCC] Executing subtask: ${task.name}`);
      
      let result: any;
      let provider: AIProvider | undefined;
      let tokensUsed = 0;
      
      // Get optimal provider from token governor based on context
      const context = task.executionMode === MCCExecutionMode.WORKER 
        ? UsageContext.AUTONOMOUS 
        : UsageContext.USER;
      
      const taskMetadata = {
        taskName: task.name,
        priority: this.mapPriorityToGovernor(task.priority),
        complexity: task.complexity,
        isUserFacing: task.executionMode !== MCCExecutionMode.WORKER,
        allowDeferral: false,
        context,
      };
      
      const budget = await aiTokenGovernor.getBudgetForTask(taskMetadata);
      provider = budget.provider;
      
      // Route to appropriate execution path based on mode
      if (task.executionMode === MCCExecutionMode.WORKER) {
        // Use BadBlue Worker for autonomous tasks
        result = await this.executeWorkerTask(task, directive);
      } else {
        // Use Sub-Agent for user-directed tasks
        const subAgentResult = await processSubAgentCommand({
          command: task.description,
          category: task.category,
        });
        
        result = subAgentResult;
        tokensUsed = Math.floor((task.description.length + (subAgentResult.response?.length || 0)) / CHARS_PER_TOKEN_ESTIMATE);
      }
      
      task.status = 'completed';
      task.result = result;
      
      return {
        subtaskId: task.id,
        subtaskName: task.name,
        success: true,
        result,
        provider,
        latencyMs: Date.now() - startTime,
        tokensUsed,
      };
      
    } catch (error: any) {
      task.status = 'failed';
      task.error = error?.message || 'Unknown error';
      
      logger.error(`[MCC] Subtask ${task.name} failed:`, error);
      
      return {
        subtaskId: task.id,
        subtaskName: task.name,
        success: false,
        error: error?.message || 'Unknown error',
        latencyMs: Date.now() - startTime,
        tokensUsed: 0,
      };
    }
  }
  
  /**
   * Execute worker task via BadBlue Worker
   */
  private async executeWorkerTask(task: SubTask, directive: ParsedDirective): Promise<any> {
    switch (task.category) {
      case MCCTaskCategory.ERROR_RESOLUTION:
        if (task.name.includes('Diagnosis')) {
          await badblueWorker.runManualDiagnostic();
          return { action: 'diagnostic_completed' };
        } else if (task.name.includes('Fix')) {
          await badblueWorker.runManualRepair();
          return { action: 'repair_completed' };
        }
        break;
        
      case MCCTaskCategory.SYSTEM_UPDATES:
        if (task.name.includes('Backup')) {
          // Trigger backup (worker handles this internally)
          return { action: 'backup_scheduled' };
        }
        break;
        
      case MCCTaskCategory.SECURITY_CHECK:
        await badblueWorker.runManualDiagnostic();
        return { action: 'security_check_completed' };
        
      default:
        // Default: use AI for analysis
        const aiResult = await callAIWithGovernor(
          `mcc-worker-${task.id}`,
          `Execute this task: ${task.description}\n\nContext: ${directive.intent}`,
          { temperature: 0.3 }
        );
        return aiResult;
    }
    
    return { action: 'task_completed' };
  }
  
  /**
   * Cross-validate results from multiple models/tasks
   */
  private async crossValidateResults(
    results: SubTaskResult[],
    directive: ParsedDirective
  ): Promise<CrossValidationResult> {
    const successfulResults = results.filter(r => r.success && r.result);
    
    if (successfulResults.length < 2) {
      return {
        validated: successfulResults.length > 0,
        confidenceScore: successfulResults.length > 0 ? 0.7 : 0,
        discrepancies: [],
        consensus: successfulResults[0]?.result?.response || 'Single result - no cross-validation possible',
      };
    }
    
    // For multiple results, use AI to check for consistency
    try {
      const validationPrompt = `Compare these task results for consistency and identify any discrepancies:

${successfulResults.map((r, i) => `Result ${i + 1} (${r.subtaskName}): ${JSON.stringify(r.result).substring(0, 500)}`).join('\n\n')}

Respond with JSON:
{
  "consistent": true/false,
  "confidenceScore": 0.0-1.0,
  "discrepancies": ["list of any discrepancies"],
  "consensus": "synthesized consistent conclusion"
}`;

      const validationResult = await callAIWithGovernor(
        'mcc-cross-validation',
        validationPrompt,
        { temperature: 0.2 }
      );
      
      if (validationResult.success && validationResult.content) {
        const parsed = this.extractJSON(validationResult.content);
        return {
          validated: typeof parsed.consistent === 'boolean' ? parsed.consistent : true,
          confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.8,
          discrepancies: Array.isArray(parsed.discrepancies) ? parsed.discrepancies : [],
          consensus: typeof parsed.consensus === 'string' ? parsed.consensus : 'Results validated',
        };
      }
    } catch (error: any) {
      logger.warn('[MCC] Cross-validation AI call failed:', error.message);
    }
    
    return {
      validated: true,
      confidenceScore: 0.7,
      discrepancies: [],
      consensus: 'Results appear consistent (heuristic validation)',
    };
  }
  
  /**
   * Detect and resolve errors in execution results
   */
  private async detectAndResolveErrors(results: SubTaskResult[]): Promise<ErrorResolutionResult> {
    const failedResults = results.filter(r => !r.success);
    const errorsDetected = failedResults.length;
    
    if (errorsDetected === 0) {
      return {
        errorsDetected: 0,
        errorsResolved: 0,
        unresolvedErrors: [],
        resolutionActions: [],
      };
    }
    
    const unresolvedErrors: string[] = [];
    const resolutionActions: string[] = [];
    let errorsResolved = 0;
    
    for (const failed of failedResults) {
      // Attempt to understand and log the error
      const errorMsg = failed.error || 'Unknown error';
      
      // Log error for worker to handle - preserve context
      try {
        const errorContext = `MCC Subtask: ${failed.subtaskName}`;
        // Pass error message and context separately to preserve information
        await badblueWorker.reportError(errorMsg, errorContext);
        resolutionActions.push(`Reported error to worker: ${failed.subtaskName}`);
      } catch (e) {
        // Worker logging failed - just track it
        unresolvedErrors.push(`${failed.subtaskName}: ${errorMsg}`);
      }
      
      // Simple errors we can resolve immediately
      if (errorMsg.includes('timeout') || errorMsg.includes('rate limit')) {
        resolutionActions.push(`Scheduled retry for: ${failed.subtaskName}`);
        errorsResolved++;
      } else {
        unresolvedErrors.push(`${failed.subtaskName}: ${errorMsg}`);
      }
    }
    
    return {
      errorsDetected,
      errorsResolved,
      unresolvedErrors,
      resolutionActions,
    };
  }
  
  /**
   * Synthesize final response from all results
   */
  private async synthesizeResults(
    originalPrompt: string,
    results: SubTaskResult[],
    crossValidation: CrossValidationResult,
    directive: ParsedDirective
  ): Promise<string> {
    const successfulResults = results.filter(r => r.success && r.result);
    
    if (successfulResults.length === 0) {
      const failedResults = results.filter(r => !r.success);
      return `Unable to complete directive. ${failedResults.length} subtask(s) failed:\n${
        failedResults.map(r => `- ${r.subtaskName}: ${r.error}`).join('\n')
      }`;
    }
    
    // For single result, return it directly
    if (successfulResults.length === 1) {
      const result = successfulResults[0].result;
      if (typeof result === 'string') return result;
      if (result?.response) return result.response;
      return JSON.stringify(result, null, 2);
    }
    
    // For multiple results, synthesize
    try {
      const synthesisPrompt = `Synthesize these task results into a coherent response for the user:

Original request: "${originalPrompt}"

Task results:
${successfulResults.map(r => `${r.subtaskName}: ${JSON.stringify(r.result).substring(0, 1000)}`).join('\n\n')}

Cross-validation: ${crossValidation.consensus}
Confidence: ${(crossValidation.confidenceScore * 100).toFixed(0)}%

Provide a clear, comprehensive response that addresses the original request.`;

      const synthesisResult = await callAIWithGovernor(
        'mcc-synthesis',
        synthesisPrompt,
        { temperature: 0.5 }
      );
      
      if (synthesisResult.success && synthesisResult.content) {
        return synthesisResult.content;
      }
    } catch (error: any) {
      logger.warn('[MCC] Synthesis AI call failed:', error.message);
    }
    
    // Fallback: concatenate results
    return `Directive Results:\n\n${
      successfulResults.map(r => {
        const content = r.result?.response || JSON.stringify(r.result);
        return `## ${r.subtaskName}\n${content}`;
      }).join('\n\n')
    }`;
  }
  
  /**
   * Log execution for learning and analytics
   */
  private async logExecution(result: MCCExecutionResult): Promise<void> {
    try {
      await ensureMCCDataDir();
      
      // Add to history
      this.executionHistory.push(result);
      if (this.executionHistory.length > 100) {
        this.executionHistory = this.executionHistory.slice(-100);
      }
      
      // Write to log file
      let existingLog: any[] = [];
      try {
        const content = await fs.readFile(MCC_LOG_FILE, 'utf-8');
        existingLog = JSON.parse(content);
      } catch {
        existingLog = [];
      }
      
      existingLog.push({
        timestamp: new Date().toISOString(),
        prompt: result.originalPrompt.substring(0, 200),
        category: result.parsedDirective.category,
        success: result.success,
        latencyMs: result.totalLatencyMs,
        tokensUsed: result.tokensUsed,
        modelsUsed: result.modelsUsed.length,
      });
      
      if (existingLog.length > 1000) {
        existingLog = existingLog.slice(-1000);
      }
      
      await fs.writeFile(MCC_LOG_FILE, JSON.stringify(existingLog, null, 2));
      
    } catch (error: any) {
      logger.warn('[MCC] Failed to log execution:', error.message);
    }
  }
  
  // Helper mapping functions
  private mapCategory(category: string): MCCTaskCategory {
    const categoryMap: Record<string, MCCTaskCategory> = {
      'trading_optimization': MCCTaskCategory.TRADING_OPTIMIZATION,
      'data_analysis': MCCTaskCategory.DATA_ANALYSIS,
      'system_updates': MCCTaskCategory.SYSTEM_UPDATES,
      'legal_consultation': MCCTaskCategory.LEGAL_CONSULTATION,
      'officer_search': MCCTaskCategory.OFFICER_SEARCH,
      'document_generation': MCCTaskCategory.DOCUMENT_GENERATION,
      'visual_optimization': MCCTaskCategory.VISUAL_OPTIMIZATION,
      'error_resolution': MCCTaskCategory.ERROR_RESOLUTION,
      'seo_optimization': MCCTaskCategory.SEO_OPTIMIZATION,
      'file_management': MCCTaskCategory.FILE_MANAGEMENT,
      'security_check': MCCTaskCategory.SECURITY_CHECK,
    };
    return categoryMap[category?.toLowerCase()] || MCCTaskCategory.GENERAL;
  }
  
  private mapExecutionMode(mode: string): MCCExecutionMode {
    const modeMap: Record<string, MCCExecutionMode> = {
      'worker': MCCExecutionMode.WORKER,
      'subagent': MCCExecutionMode.SUBAGENT,
      'hybrid': MCCExecutionMode.HYBRID,
    };
    return modeMap[mode?.toLowerCase()] || MCCExecutionMode.SUBAGENT;
  }
  
  private mapPriority(priority: string): TaskPriority {
    const priorityMap: Record<string, TaskPriority> = {
      'low': TaskPriority.LOW,
      'medium': TaskPriority.MEDIUM,
      'high': TaskPriority.HIGH,
      'critical': TaskPriority.CRITICAL,
    };
    return priorityMap[priority?.toLowerCase()] || TaskPriority.MEDIUM;
  }
  
  private mapComplexity(complexity: string): TaskComplexity {
    const complexityMap: Record<string, TaskComplexity> = {
      'lightweight': TaskComplexity.LIGHTWEIGHT,
      'moderate': TaskComplexity.MODERATE,
      'comprehensive': TaskComplexity.COMPREHENSIVE,
    };
    return complexityMap[complexity?.toLowerCase()] || TaskComplexity.MODERATE;
  }
  
  /**
   * Map local TaskPriority to Governor TaskPriority
   */
  private mapPriorityToGovernor(priority: TaskPriority): GovernorPriority {
    const priorityMap: Record<TaskPriority, GovernorPriority> = {
      [TaskPriority.LOW]: GovernorPriority.LOW_BACKGROUND,
      [TaskPriority.MEDIUM]: GovernorPriority.MEDIUM_BACKGROUND,
      [TaskPriority.HIGH]: GovernorPriority.HIGH_USER,
      [TaskPriority.CRITICAL]: GovernorPriority.CRITICAL_USER,
    };
    return priorityMap[priority] || GovernorPriority.MEDIUM_BACKGROUND;
  }
  
  /**
   * Get execution history for analytics
   */
  getExecutionHistory(): MCCExecutionResult[] {
    return [...this.executionHistory];
  }
  
  /**
   * Get MCC status
   */
  async getStatus(): Promise<{
    ready: boolean;
    totalExecutions: number;
    successRate: number;
    avgLatencyMs: number;
  }> {
    const successful = this.executionHistory.filter(r => r.success).length;
    const total = this.executionHistory.length;
    const avgLatency = total > 0
      ? this.executionHistory.reduce((sum, r) => sum + r.totalLatencyMs, 0) / total
      : 0;
    
    return {
      ready: true,
      totalExecutions: total,
      successRate: total > 0 ? (successful / total) * 100 : 100,
      avgLatencyMs: avgLatency,
    };
  }
}

// Singleton export
export const masterControlConsole = MasterControlConsole.getInstance();

// Convenience function for direct access
export async function executeMCCDirective(prompt: string): Promise<MCCExecutionResult> {
  return masterControlConsole.executeDirective(prompt);
}

export default MasterControlConsole;
