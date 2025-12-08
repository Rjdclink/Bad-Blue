// Execution Orchestrator - Adaptive Execution with Gas-Aware Timing & Sentiment Analysis
import { Opportunity } from '../core/lux-swarm';

enum ExecutionTier { ULTRA_SAFE = 'ULTRA_SAFE', SAFE = 'SAFE', BALANCED = 'BALANCED', AGGRESSIVE = 'AGGRESSIVE' }

// Configuration constants
const POSITIVE_TOKENS = ['USDC', 'USDT', 'WETH', 'WMATIC'];
const SENTIMENT_ADJUSTMENT = 0.2;
const CURRENT_GAS_GWEI = 30;
const TARGET_GAS_GWEI = 25;
const GAS_WAIT_THRESHOLD = 1.5;
const MAX_GAS_WAIT_MS = 10000;

interface OpportunityScore {
  opportunity: Opportunity;
  successProbability: number;
  expectedValue: number;
  tier?: ExecutionTier;
}

interface ExecutionPlan {
  opportunities: OpportunityScore[];
  mode: 'isolated' | 'cluster';
  gasMultiplier: number;
  loanSize: number;
  priority: number;
}

interface ExecutionResults {
  attempted: number;
  succeeded: number;
  profit: number;
  gasCost: number;
}

class OpportunityQualityAnalyzer {
  async analyze(opp: Opportunity): Promise<OpportunityScore> {
    const baseProb = Math.min(0.95, 0.3 + (opp.priority / 100) * 0.5);
    return { opportunity: opp, successProbability: baseProb, expectedValue: opp.profitEstimate * baseProb };
  }
}

class RiskTierSystem {
  classify(scored: OpportunityScore[]): Map<ExecutionTier, OpportunityScore[]> {
    const groups = new Map<ExecutionTier, OpportunityScore[]>([
      [ExecutionTier.ULTRA_SAFE, []], [ExecutionTier.SAFE, []], [ExecutionTier.BALANCED, []], [ExecutionTier.AGGRESSIVE, []]
    ]);
    scored.forEach(opp => {
      const prob = opp.successProbability;
      const tier = prob >= 0.9 ? ExecutionTier.ULTRA_SAFE : prob >= 0.7 ? ExecutionTier.SAFE : prob >= 0.5 ? ExecutionTier.BALANCED : ExecutionTier.AGGRESSIVE;
      opp.tier = tier;
      groups.get(tier)!.push(opp);
    });
    return groups;
  }
  calculateExpectedProfit(groups: Map<ExecutionTier, OpportunityScore[]>): number {
    let total = 0;
    groups.forEach(opps => { total += opps.reduce((sum, o) => sum + o.expectedValue, 0); });
    return total;
  }
}

class ExecutionOrchestrator {
  private analyzer = new OpportunityQualityAnalyzer();
  private tierSystem = new RiskTierSystem();

  async orchestrate(opportunities: Opportunity[]): Promise<ExecutionResults> {
    const scored = await Promise.all(opportunities.map(opp => this.analyzeWithSentiment(opp)));
    const groups = this.tierSystem.classify(scored);
    console.log('📊 Tier Distribution:');
    groups.forEach((opps, tier) => { if (opps.length > 0) console.log(`  ${tier}: ${opps.length}`); });
    console.log(`💰 Expected: ${this.tierSystem.calculateExpectedProfit(groups).toFixed(2)}`);
    return await this.executeWithGasOptimization(await this.allocate(groups));
  }
  
  private async analyzeWithSentiment(opp: Opportunity): Promise<OpportunityScore> {
    const baseAnalysis = await this.analyzer.analyze(opp);
    const sentimentScore = POSITIVE_TOKENS.includes(opp.asset.split('/')[0]) ? 0.1 : 0;
    const adjusted = baseAnalysis.successProbability * (1 + sentimentScore * SENTIMENT_ADJUSTMENT);
    return { ...baseAnalysis, successProbability: Math.min(1.0, Math.max(0, adjusted)) };
  }
  
  private async allocate(groups: Map<ExecutionTier, OpportunityScore[]>): Promise<ExecutionPlan[]> {
    const plan: ExecutionPlan[] = [];
    groups.get(ExecutionTier.ULTRA_SAFE)?.forEach(opp => plan.push({ opportunities: [opp], mode: 'isolated', gasMultiplier: 2.0, loanSize: 50000, priority: 1 }));
    groups.get(ExecutionTier.SAFE)?.forEach(opp => plan.push({ opportunities: [opp], mode: 'isolated', gasMultiplier: 1.5, loanSize: 10000, priority: 2 }));
    const balanced = groups.get(ExecutionTier.BALANCED) || [];
    for (let i = 0; i < balanced.length; i += 10) plan.push({ opportunities: balanced.slice(i, i + 10), mode: 'cluster', gasMultiplier: 1.2, loanSize: 5000, priority: 3 });
    const aggressive = groups.get(ExecutionTier.AGGRESSIVE) || [];
    for (let i = 0; i < aggressive.length; i += 50) plan.push({ opportunities: aggressive.slice(i, i + 50), mode: 'cluster', gasMultiplier: 1.0, loanSize: 2000, priority: 4 });
    return plan.sort((a, b) => a.priority - b.priority);
  }
  
  private async executeWithGasOptimization(plan: ExecutionPlan[]): Promise<ExecutionResults> {
    const results = {attempted: 0, succeeded: 0, profit: 0, gasCost: 0};
    for (const item of plan) {
      const optimalGas = await this.findOptimalGasWindow(item.gasMultiplier);
      if (optimalGas.waitTime > 0) {
        console.log(`⏳ Waiting ${optimalGas.waitTime}ms for optimal gas`);
        await this.sleep(optimalGas.waitTime);
      }
      if (item.mode === 'isolated') {
        for (const opp of item.opportunities) {
          const result = await this.executeOne(opp, item);
          results.attempted++;
          if (result.success) { results.succeeded++; results.profit += result.profit; }
          results.gasCost += result.gasCost;
        }
      } else {
        const result = await this.executeCluster(item.opportunities, item);
        results.attempted += item.opportunities.length;
        results.succeeded += result.succeeded;
        results.profit += result.profit;
        results.gasCost += result.gasCost;
      }
    }
    console.log(`✅ ${results.succeeded}/${results.attempted} succeeded`);
    console.log(`💎 Net: ${(results.profit - results.gasCost).toFixed(2)}`);
    return results;
  }
  
  private async findOptimalGasWindow(multiplier: number): Promise<{waitTime: number, expectedGas: number}> {
    if (CURRENT_GAS_GWEI <= TARGET_GAS_GWEI * multiplier) return {waitTime: 0, expectedGas: CURRENT_GAS_GWEI};
    return {waitTime: multiplier < GAS_WAIT_THRESHOLD ? MAX_GAS_WAIT_MS : 0, expectedGas: TARGET_GAS_GWEI};
  }
  
  private async executeOne(opp: OpportunityScore, config: ExecutionPlan) {
    return {success: Math.random() < opp.successProbability, profit: opp.expectedValue, gasCost: 0.5};
  }
  
  private async executeCluster(opps: OpportunityScore[], config: ExecutionPlan) {
    const avgProb = opps.reduce((s, o) => s + o.successProbability, 0) / opps.length;
    const succeeded = Math.floor(opps.length * avgProb);
    return { succeeded, profit: opps.slice(0, succeeded).reduce((s, o) => s + o.expectedValue, 0), gasCost: opps.length * 0.15 };
  }
  
  private sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
}

export { ExecutionOrchestrator, OpportunityQualityAnalyzer, RiskTierSystem, ExecutionTier };
export type { ExecutionPlan, ExecutionResults, OpportunityScore };
