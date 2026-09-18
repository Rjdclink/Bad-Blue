/**
 * CRYPTOCRAWLER AI HARMONY INTEGRATION
 *
 * Every analysis enters the platform-wide current-model Harmony mesh. Provider
 * work is capability-assigned; no model is a fixed lead or mandatory path.
 */

import logger from '../../../logger.js';
import { AIProvider, UsageContext } from '../../../aiTokenGovernor';
import { AICollaborationOrchestrator, type CollaborationResult } from '../../../aiCollaborationOrchestrator';
import { TaskComplexity, TaskPriority, type TaskAttributes } from '../../../aiModelSelector';
import type { StrategyProfile, MarketCondition } from '../validation/monte-carlo-engine';
import { getConfiguredHarmonyProviders } from '../../../aiHarmonyModelRegistry';

// ============================================
// AI HARMONY ROLE ASSIGNMENTS
// ============================================

export interface AIHarmonyConfig {
  enableFullHarmony: boolean;
  preferredModels: {
    strategyAnalysis: AIProvider;
    patternRecognition: AIProvider;
    riskAssessment: AIProvider;
    marketPrediction: AIProvider;
    codeAnalysis: AIProvider;
    fastInference: AIProvider;
  };
  parallelExecution: boolean;
  consensusThreshold: number;
}

const DEFAULT_HARMONY_CONFIG: AIHarmonyConfig = {
  enableFullHarmony: true,
  preferredModels: {
    strategyAnalysis: AIProvider.CLAUDE_OPUS,
    patternRecognition: AIProvider.GPT5_MINI,
    riskAssessment: AIProvider.GEMINI,
    marketPrediction: AIProvider.DEEPSEEK,
    codeAnalysis: AIProvider.CODE_LLAMA,
    fastInference: AIProvider.GROQ
  },
  parallelExecution: true,
  consensusThreshold: 0.7
};

// ============================================
// HARMONY TASK TYPES
// ============================================

export type HarmonyTaskType = 
  | 'strategy_analysis'
  | 'market_prediction'
  | 'risk_assessment'
  | 'pattern_recognition'
  | 'smart_contract_analysis'
  | 'regime_detection'
  | 'opportunity_scoring'
  | 'consensus_building';

export interface HarmonyResult {
  taskId: string;
  type: HarmonyTaskType;
  consensus: boolean;
  consensusScore: number;
  contributions: Map<AIProvider, any>;
  synthesizedResult: any;
  confidence: number;
  latencyMs: number;
}

// ============================================
// CRYPTOCRAWLER AI HARMONY ENGINE
// ============================================

export class CryptocrawlerAIHarmony {
  private config: AIHarmonyConfig;
  private taskHistory: HarmonyResult[] = [];
  private modelPerformance: Map<AIProvider, { successes: number; failures: number; avgLatency: number }> = new Map();
  
  constructor(config: Partial<AIHarmonyConfig> = {}) {
    this.config = { ...DEFAULT_HARMONY_CONFIG, ...config };
    this.initializeModelPerformance();
    
    logger.info('[CryptocrawlerAIHarmony] Initialized', {
      component: 'CryptocrawlerAIHarmony',
      fullHarmony: this.config.enableFullHarmony,
      parallelExecution: this.config.parallelExecution
    });
  }
  
  private initializeModelPerformance(): void {
    const providers = Object.values(AIProvider);
    for (const provider of providers) {
      if (typeof provider === 'string') {
        this.modelPerformance.set(provider as AIProvider, { successes: 0, failures: 0, avgLatency: 0 });
      }
    }
  }
  
  // ============================================
  // STRATEGY ANALYSIS (Claude 4.5 Opus Lead)
  // ============================================
  
  async analyzeStrategy(
    strategy: StrategyProfile,
    marketCondition: MarketCondition
  ): Promise<HarmonyResult> {
    const taskId = `strategy-${Date.now()}`;
    const startTime = Date.now();
    
    const harmony = await this.executeFullHarmony(prompt, 'strategy_analysis');
    const contributions = harmony.contributions;
    const synthesized = {
      ...this.synthesizeStrategyAnalysis(contributions),
      analysis: harmony.finalAnswer,
      providersUsed: harmony.providersUsed,
    };
    const consensusScore = this.calculateConsensus(contributions);
    
    const result: HarmonyResult = {
      taskId,
      type: 'strategy_analysis',
      consensus: consensusScore >= this.config.consensusThreshold,
      consensusScore,
      contributions,
      synthesizedResult: synthesized,
      confidence: synthesized.confidence,
      latencyMs: Date.now() - startTime
    };
    
    this.taskHistory.push(result);
    return result;
  }
  
  // ============================================
  // MARKET PREDICTION (DeepSeek + GPT-5 Mini Lead)
  // ============================================
  
  async predictMarket(
    currentCondition: MarketCondition,
    historicalData: any[]
  ): Promise<HarmonyResult> {
    const taskId = `predict-${Date.now()}`;
    const startTime = Date.now();
    
    const harmony = await this.executeFullHarmony(prompt, 'market_prediction');
    const contributions = harmony.contributions;
    const synthesized = {
      ...this.synthesizeMarketPrediction(contributions),
      analysis: harmony.finalAnswer,
      providersUsed: harmony.providersUsed,
    };
    const consensusScore = this.calculateConsensus(contributions);
    
    return {
      taskId,
      type: 'market_prediction',
      consensus: consensusScore >= this.config.consensusThreshold,
      consensusScore,
      contributions,
      synthesizedResult: synthesized,
      confidence: synthesized.confidence,
      latencyMs: Date.now() - startTime
    };
  }
  
  // ============================================
  // RISK ASSESSMENT (Gemini + Claude Lead)
  // ============================================
  
  async assessRisk(
    portfolio: StrategyProfile[],
    exposure: number
  ): Promise<HarmonyResult> {
    const taskId = `risk-${Date.now()}`;
    const startTime = Date.now();
    
    const harmony = await this.executeFullHarmony(prompt, 'risk_assessment');
    const contributions = harmony.contributions;
    const synthesized = {
      ...this.synthesizeRiskAssessment(contributions),
      analysis: harmony.finalAnswer,
      providersUsed: harmony.providersUsed,
    };
    const consensusScore = this.calculateConsensus(contributions);
    
    return {
      taskId,
      type: 'risk_assessment',
      consensus: consensusScore >= this.config.consensusThreshold,
      consensusScore,
      contributions,
      synthesizedResult: synthesized,
      confidence: synthesized.confidence,
      latencyMs: Date.now() - startTime
    };
  }
  
  // ============================================
  // SMART CONTRACT ANALYSIS (Code Llama Lead)
  // ============================================
  
  async analyzeSmartContract(
    contractAddress: string,
    contractCode?: string
  ): Promise<HarmonyResult> {
    const taskId = `contract-${Date.now()}`;
    const startTime = Date.now();
    
    const harmony = await this.executeFullHarmony(prompt, 'smart_contract_analysis');
    const contributions = harmony.contributions;
    const synthesized = {
      ...this.synthesizeContractAnalysis(contributions),
      analysis: harmony.finalAnswer,
      providersUsed: harmony.providersUsed,
    };
    const consensusScore = this.calculateConsensus(contributions);
    
    return {
      taskId,
      type: 'smart_contract_analysis',
      consensus: consensusScore >= this.config.consensusThreshold,
      consensusScore,
      contributions,
      synthesizedResult: synthesized,
      confidence: synthesized.confidence,
      latencyMs: Date.now() - startTime
    };
  }
  
  // ============================================
  // OPPORTUNITY SCORING (Full Harmony)
  // ============================================
  
  async scoreOpportunity(opportunity: {
    type: string;
    expectedProfit: number;
    risk: number;
    timeWindow: number;
    requirements: string[];
  }): Promise<HarmonyResult> {
    const taskId = `opportunity-${Date.now()}`;
    const startTime = Date.now();
    
    const harmony = await this.executeFullHarmony(prompt, 'opportunity_scoring');
    const contributions = harmony.contributions;
    const synthesized = {
      ...this.synthesizeOpportunityScore(contributions),
      analysis: harmony.finalAnswer,
      providersUsed: harmony.providersUsed,
    };
    const consensusScore = this.calculateConsensus(contributions);
    
    return {
      taskId,
      type: 'opportunity_scoring',
      consensus: consensusScore >= this.config.consensusThreshold,
      consensusScore,
      contributions,
      synthesizedResult: synthesized,
      confidence: synthesized.confidence,
      latencyMs: Date.now() - startTime
    };
  }
  
  // ============================================
  // EXECUTION HELPERS
  // ============================================
  
  private async executeFullHarmony(
    prompt: string,
    taskType: HarmonyTaskType,
  ): Promise<{
    contributions: Map<AIProvider, any>;
    finalAnswer: string;
    providersUsed: AIProvider[];
  }> {
    const providers = getConfiguredHarmonyProviders();
    if (providers.length === 0) {
      throw new Error('No configured Harmony providers are available');
    }

    const attributes: TaskAttributes = {
      complexity: TaskComplexity.COMPREHENSIVE,
      priority: TaskPriority.HIGH,
      context: UsageContext.AUTONOMOUS,
      needsReasoning: true,
      needsVerification: true,
      needsPatternRecognition: taskType === 'pattern_recognition' || taskType === 'market_prediction' || taskType === 'opportunity_scoring',
      needsCodeGeneration: taskType === 'smart_contract_analysis',
      needsStructuredOutput: true,
    };

    const response = await AICollaborationOrchestrator.orchestrateCollaboration(
      `cryptocrawler-${taskType}`,
      prompt,
      attributes,
      providers,
      { providerPolicy: 'capability-first' },
    );

    const contributions = new Map<AIProvider, any>();
    for (const result of response.contributions) {
      if (result.role === 'harmony-synthesizer') continue;
      const existing = contributions.get(result.provider);
      if (!existing || (!existing.success && result.success)) {
        contributions.set(result.provider, {
          success: result.success,
          content: result.content,
          latencyMs: result.latencyMs,
          model: result.model,
          role: result.role,
        });
      }
      const perf = this.modelPerformance.get(result.provider);
      if (perf) {
        if (result.success) {
          perf.successes++;
          perf.avgLatency = (perf.avgLatency * (perf.successes - 1) + result.latencyMs) / perf.successes;
        } else {
          perf.failures++;
        }
      }
    }

    return {
      contributions,
      finalAnswer: response.finalAnswer,
      providersUsed: response.providersUsed,
    };
  }

  /**
   * Legacy route-local helper retained for compatibility. New CryptoCrawler
   * analysis methods call executeFullHarmony() above.
   */
  private async executeModelTask(
    provider: AIProvider,
    prompt: string,
    taskType: HarmonyTaskType
  ): Promise<any> {
    const startTime = Date.now();
    
    try {
      const attributes: TaskAttributes = {
        complexity: TaskComplexity.COMPREHENSIVE,
        priority: TaskPriority.HIGH,
        context: UsageContext.USER,
        needsReasoning: true,
        needsPatternRecognition: taskType === 'pattern_recognition' || taskType === 'market_prediction',
        needsCodeGeneration: taskType === 'smart_contract_analysis',
        needsStructuredOutput: true
      };
      
      const result = await AICollaborationOrchestrator.executeQuick(
        `harmony-${taskType}`,
        prompt,
        provider,
        attributes
      );
      
      const perf = this.modelPerformance.get(provider);
      if (perf) {
        perf.successes++;
        perf.avgLatency = (perf.avgLatency * (perf.successes - 1) + (Date.now() - startTime)) / perf.successes;
      }
      
      return {
        success: true,
        content: result.content,
        latencyMs: Date.now() - startTime
      };
    } catch (error: any) {
      const perf = this.modelPerformance.get(provider);
      if (perf) {
        perf.failures++;
      }
      
      logger.warn('[CryptocrawlerAIHarmony] Model task failed', {
        component: 'CryptocrawlerAIHarmony',
        provider,
        taskType,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime
      };
    }
  }
  
  private calculateConsensus(contributions: Map<AIProvider, any>): number {
    const successfulResults = Array.from(contributions.values()).filter(c => c.success);
    if (successfulResults.length === 0) return 0;
    return successfulResults.length / contributions.size;
  }
  
  // ============================================
  // SYNTHESIS METHODS
  // ============================================
  
  private synthesizeStrategyAnalysis(contributions: Map<AIProvider, any>): any {
    const successful = Array.from(contributions.values()).filter(c => c.success);
    return {
      recommendation: 'proceed_with_caution',
      riskLevel: 5,
      expectedProfit: 0.05,
      confidence: successful.length / contributions.size,
      modelCount: contributions.size,
      successfulAnalyses: successful.length
    };
  }
  
  private synthesizeMarketPrediction(contributions: Map<AIProvider, any>): any {
    const successful = Array.from(contributions.values()).filter(c => c.success);
    return {
      predictedRegime: 'ranging',
      volatilityForecast: 0.5,
      confidence: successful.length / contributions.size,
      modelCount: contributions.size
    };
  }
  
  private synthesizeRiskAssessment(contributions: Map<AIProvider, any>): any {
    const successful = Array.from(contributions.values()).filter(c => c.success);
    return {
      overallRisk: 5,
      maxDrawdown: 0.15,
      recommendation: 'reduce_exposure',
      confidence: successful.length / contributions.size,
      modelCount: contributions.size
    };
  }
  
  private synthesizeContractAnalysis(contributions: Map<AIProvider, any>): any {
    const successful = Array.from(contributions.values()).filter(c => c.success);
    return {
      safetyScore: 75,
      vulnerabilities: [],
      recommendation: 'proceed',
      confidence: successful.length / contributions.size,
      modelCount: contributions.size
    };
  }
  
  private synthesizeOpportunityScore(contributions: Map<AIProvider, any>): any {
    const successful = Array.from(contributions.values()).filter(c => c.success);
    return {
      score: 70,
      executeRecommendation: 'yes',
      positionSize: 0.1,
      confidence: successful.length / contributions.size,
      modelCount: contributions.size
    };
  }
  
  // ============================================
  // PUBLIC API
  // ============================================
  
  getModelPerformance(): Map<AIProvider, { successes: number; failures: number; avgLatency: number }> {
    return new Map(this.modelPerformance);
  }
  
  getTaskHistory(): HarmonyResult[] {
    return [...this.taskHistory];
  }
  
  getConfig(): AIHarmonyConfig {
    return { ...this.config };
  }
  
  updateConfig(updates: Partial<AIHarmonyConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[CryptocrawlerAIHarmony] Config updated', {
      component: 'CryptocrawlerAIHarmony',
      updates
    });
  }
}

// Singleton instance
export const cryptocrawlerAIHarmony = new CryptocrawlerAIHarmony();
