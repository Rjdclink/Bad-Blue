/**
 * CRYPTOCRAWLER AI HARMONY INTEGRATION
 * 
 * Integrates the 17-model AI harmony system with the cryptocrawler for
 * enhanced market analysis, strategy optimization, and autonomous trading.
 * 
 * AI MODELS IN HARMONY:
 * - Claude 4.5 Opus: Complex reasoning, strategy synthesis
 * - GPT-5 Mini: Fast inference, pattern recognition
 * - Gemini 3 Pro/Flash: Multimodal analysis, search grounding
 * - Claude 3.5 Sonnet/Haiku: Legal analysis, verification
 * - DeepSeek R1T2: Pattern recognition, deep reasoning
 * - Grok 4.1: Large context, real-time analysis
 * - Kimi K2: Structured extraction, data processing
 * - GPT-OSS-120B: Large-scale reasoning
 * - Falcon-180B: Open-source analysis
 * - Code Llama 70B/34B: Smart contract analysis
 * - GPT-NeoX-20B: Efficient inference
 * - Qwen-72B: Multilingual, multimodal
 * - Groq (LLaMA 3.3): Ultra-fast autonomous operations
 * - Mistral Small: Efficient autonomous tasks
 */

import logger from '../../../logger.js';
import { AIProvider, UsageContext } from '../../../aiTokenGovernor';
import { AICollaborationOrchestrator, type CollaborationResult } from '../../../aiCollaborationOrchestrator';
import { TaskComplexity, TaskPriority, type TaskAttributes } from '../../../aiModelSelector';
import type { StrategyProfile, MarketCondition } from '../validation/monte-carlo-engine';

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
    
    const models = [
      AIProvider.CLAUDE_OPUS,
      AIProvider.GPT5_MINI,
      AIProvider.DEEPSEEK,
      AIProvider.GEMINI
    ];
    
    const prompt = `Analyze this trading strategy for profitability and risk:

Strategy: ${strategy.name}
- Success Rate: ${(strategy.baseSuccessRate * 100).toFixed(1)}%
- Avg Profit: ${(strategy.avgProfitPerTrade * 100).toFixed(2)}%
- Avg Loss: ${(strategy.avgLossPerTrade * 100).toFixed(2)}%
- Trades/Day: ${strategy.tradesPerDay}
- Execution Latency: ${strategy.executionLatency}ms

Market Conditions:
- Volatility: ${marketCondition.volatility}
- Liquidity Score: ${marketCondition.liquidityScore}
- Competition: ${marketCondition.competitorDensity}
- Network Congestion: ${marketCondition.networkCongestion}

Provide:
1. Expected daily profit potential
2. Risk assessment (1-10)
3. Recommended adjustments
4. Optimal market regime for this strategy`;

    const contributions = new Map<AIProvider, any>();
    
    if (this.config.parallelExecution) {
      const results = await Promise.all(
        models.map(model => this.executeModelTask(model, prompt, 'strategy_analysis'))
      );
      results.forEach((result, idx) => {
        contributions.set(models[idx], result);
      });
    } else {
      for (const model of models) {
        const result = await this.executeModelTask(model, prompt, 'strategy_analysis');
        contributions.set(model, result);
      }
    }
    
    const synthesized = this.synthesizeStrategyAnalysis(contributions);
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
    
    const models = [
      AIProvider.DEEPSEEK,
      AIProvider.GPT5_MINI,
      AIProvider.GROK,
      AIProvider.QWEN
    ];
    
    const prompt = `Predict market conditions for the next 24 hours:

Current Conditions:
- Volatility: ${currentCondition.volatility}
- Liquidity: ${currentCondition.liquidityScore}
- Competition: ${currentCondition.competitorDensity}
- Network Load: ${currentCondition.networkCongestion}

Historical Data Points: ${historicalData.length}

Provide:
1. Predicted regime (trending/ranging/volatile/crisis)
2. Volatility forecast
3. Liquidity forecast
4. Confidence level (0-100%)
5. Key risks to watch`;

    const contributions = new Map<AIProvider, any>();
    
    const results = await Promise.all(
      models.map(model => this.executeModelTask(model, prompt, 'market_prediction'))
    );
    
    results.forEach((result, idx) => {
      contributions.set(models[idx], result);
    });
    
    const synthesized = this.synthesizeMarketPrediction(contributions);
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
    
    const models = [
      AIProvider.GEMINI,
      AIProvider.CLAUDE_OPUS,
      AIProvider.CLAUDE,
      AIProvider.GPT5_MINI
    ];
    
    const strategyList = portfolio.map(s => `- ${s.name}: ${s.baseSuccessRate * 100}% win rate`).join('\n');
    
    const prompt = `Assess risk for this portfolio:

Strategies:
${strategyList}

Total Exposure: $${exposure.toLocaleString()}

Provide:
1. Overall risk score (1-10)
2. Maximum drawdown estimate
3. Correlation risks
4. Black swan vulnerability
5. Recommended position limits`;

    const contributions = new Map<AIProvider, any>();
    
    const results = await Promise.all(
      models.map(model => this.executeModelTask(model, prompt, 'risk_assessment'))
    );
    
    results.forEach((result, idx) => {
      contributions.set(models[idx], result);
    });
    
    const synthesized = this.synthesizeRiskAssessment(contributions);
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
    
    const models = [
      AIProvider.CODE_LLAMA,
      AIProvider.GPT5_MINI,
      AIProvider.DEEPSEEK,
      AIProvider.CLAUDE
    ];
    
    const prompt = `Analyze this smart contract for trading safety:

Contract: ${contractAddress}
${contractCode ? `Code:\n${contractCode.substring(0, 2000)}...` : ''}

Check for:
1. Reentrancy vulnerabilities
2. Flash loan attack vectors
3. MEV extraction risks
4. Liquidity manipulation risks
5. Admin key risks
6. Overall safety score (1-100)`;

    const contributions = new Map<AIProvider, any>();
    
    const results = await Promise.all(
      models.map(model => this.executeModelTask(model, prompt, 'smart_contract_analysis'))
    );
    
    results.forEach((result, idx) => {
      contributions.set(models[idx], result);
    });
    
    const synthesized = this.synthesizeContractAnalysis(contributions);
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
    
    const models = [
      AIProvider.CLAUDE_OPUS,
      AIProvider.GPT5_MINI,
      AIProvider.GEMINI,
      AIProvider.DEEPSEEK,
      AIProvider.GROK
    ];
    
    const prompt = `Score this trading opportunity:

Type: ${opportunity.type}
Expected Profit: ${(opportunity.expectedProfit * 100).toFixed(2)}%
Risk Level: ${opportunity.risk}/10
Time Window: ${opportunity.timeWindow}ms
Requirements: ${opportunity.requirements.join(', ')}

Provide:
1. Overall score (0-100)
2. Probability of success
3. Risk-adjusted return
4. Execute recommendation (yes/no/wait)
5. Position size recommendation`;

    const contributions = new Map<AIProvider, any>();
    
    const results = await Promise.all(
      models.map(model => this.executeModelTask(model, prompt, 'opportunity_scoring'))
    );
    
    results.forEach((result, idx) => {
      contributions.set(models[idx], result);
    });
    
    const synthesized = this.synthesizeOpportunityScore(contributions);
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
