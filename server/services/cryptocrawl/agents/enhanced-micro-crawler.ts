// Enhanced Micro Crawler with Growth/Shrink Capabilities
// Implements dynamic scaling based on priority and opportunity density

import { randomUUID } from 'crypto';
import { eden } from '../eden/service';
import { EDEN_CONFIG, CONTROL_SIGNALS } from '../eden/config';
import { LuxSwarm, type Opportunity } from '../core/lux-swarm';
import type { MicroCrawlerState, ChainId } from '../eden/types';

export type CrawlerMode = 'micro' | 'full';
export type CrawlerStatus = 'idle' | 'scanning' | 'executing' | 'shrinking' | 'growing';

export class EnhancedMicroCrawler {
  id: string;
  parentCainId: string;
  mode: CrawlerMode;
  priority: number;
  target?: string;
  chain?: ChainId;
  status: CrawlerStatus;
  lastActivity: number;
  profitGenerated: number;

  private idleStartTime: number = 0;
  private opportunityCount: number = 0;
  private estimatedROI: number = 0;
  private runningCost: number = 0;

  constructor(parentCainId: string, mode: CrawlerMode = 'micro') {
    this.id = `micro-${randomUUID().split('-')[0]}`;
    this.parentCainId = parentCainId;
    this.mode = mode;
    this.priority = 0;
    this.status = 'idle';
    this.lastActivity = Date.now();
    this.profitGenerated = 0;
  }

  // Main crawl operation
  async crawl(): Promise<void> {
    try {
      this.lastActivity = Date.now();
      this.status = 'scanning';

      // Observe swarm state
      const lux = LuxSwarm.observe();

      // Check if should grow to full mode
      if (this.shouldGrow(lux)) {
        await this.grow();
      }

      // Check if should shrink to micro mode
      if (this.shouldShrink()) {
        await this.shrink();
      }

      // Perform work based on mode
      if (this.mode === 'full') {
        await this.fullCrawl(lux);
      } else {
        await this.microCrawl(lux);
      }

      // Update metrics
      await this.updateMetrics();

    } catch (error) {
      console.error(`[MICRO-${this.id}] ❌ Error:`, error);
      this.status = 'idle';
    }
  }

  // Check if should grow to full mode
  private shouldGrow(lux: any): boolean {
    if (this.mode === 'full') return false;

    // Calculate priority score
    const priorityScore = this.calculatePriorityScore();

    // Grow if priority score exceeds threshold
    if (priorityScore >= EDEN_CONFIG.GROWTH_THRESHOLD) {
      return true;
    }

    // Grow if high opportunity density
    const opportunitiesPerNode = lux.opportunities.length / Math.max(lux.agentStates.size, 1);
    if (opportunitiesPerNode > EDEN_CONFIG.OPPS_PER_NODE_THRESHOLD) {
      return true;
    }

    // Grow if estimated ROI is high
    if (this.estimatedROI >= EDEN_CONFIG.ROI_GROWTH_MIN) {
      return true;
    }

    return false;
  }

  // Check if should shrink to micro mode
  private shouldShrink(): boolean {
    if (this.mode === 'micro') return false;

    // Calculate priority score
    const priorityScore = this.calculatePriorityScore();

    // Shrink if priority score below threshold
    if (priorityScore <= EDEN_CONFIG.SHRINK_THRESHOLD) {
      return true;
    }

    // Shrink if idle too long
    const idleTime = Date.now() - this.lastActivity;
    if (idleTime > EDEN_CONFIG.IDLE_LIMIT_MS) {
      return true;
    }

    // Shrink if cost per opportunity too high
    const costPerOpp = this.runningCost / Math.max(this.opportunityCount, 1);
    if (costPerOpp > EDEN_CONFIG.COST_CAP_PER_OPP) {
      return true;
    }

    return false;
  }

  // Grow to full mode
  private async grow(): Promise<void> {
    console.log(`[MICRO-${this.id}] 📈 Growing to FULL mode`);
    
    this.status = 'growing';
    this.mode = 'full';
    
    // Reset idle timer
    this.idleStartTime = 0;
    
    console.log(`[MICRO-${this.id}] ✅ Now in FULL mode`);
  }

  // Shrink to micro mode
  private async shrink(): Promise<void> {
    console.log(`[MICRO-${this.id}] 📉 Shrinking to MICRO mode`);
    
    this.status = 'shrinking';
    this.mode = 'micro';
    
    // Clear target and chain
    this.target = undefined;
    this.chain = undefined;
    
    // Reset metrics
    this.opportunityCount = 0;
    this.runningCost = 0;
    
    console.log(`[MICRO-${this.id}] ✅ Now in MICRO mode`);
  }

  // Full crawler operation
  private async fullCrawl(lux: any): Promise<void> {
    // Find high-priority unclaimed opportunities
    const opportunities = lux.opportunities.filter(
      (opp: Opportunity) => !lux.claimed.has(opp.asset) && opp.priority >= 50
    );

    if (opportunities.length === 0) {
      this.status = 'idle';
      if (this.idleStartTime === 0) {
        this.idleStartTime = Date.now();
      }
      return;
    }

    // Sort by priority
    opportunities.sort((a: Opportunity, b: Opportunity) => b.priority - a.priority);

    // Take highest priority
    const opp = opportunities[0];
    this.target = opp.asset;
    this.chain = opp.chain;
    this.priority = opp.priority;

    // Calculate profitability objective
    const profitabilityScore = eden.calculateProfitabilityObjective(
      opp.profitEstimate,
      0.1, // Assume 10% risk
      0.001, // Assume $0.001 cost
      0
    );

    if (profitabilityScore > 0) {
      await this.execute(opp, profitabilityScore);
    }
  }

  // Micro crawler operation (lightweight monitoring)
  private async microCrawl(lux: any): Promise<void> {
    // Just monitor for high-priority signals
    const highPriorityOpps = lux.opportunities.filter(
      (opp: Opportunity) => opp.priority >= 70
    );

    if (highPriorityOpps.length > 0) {
      // Signal that growth may be needed
      this.estimatedROI = highPriorityOpps[0].profitEstimate / 0.001; // profit / cost
      this.opportunityCount = highPriorityOpps.length;
    } else {
      this.status = 'idle';
    }
  }

  // Execute opportunity
  private async execute(opp: Opportunity, profitabilityScore: number): Promise<void> {
    console.log(`[MICRO-${this.id}] ⚡ Executing ${opp.asset} on ${opp.chain}`);
    
    this.status = 'executing';

    try {
      // Check ethical guards
      const ethicalCheck = await eden.checkEthicalGuards({
        type: 'execution',
        opportunity: opp,
      });

      if (!ethicalCheck.passed) {
        console.warn(`[MICRO-${this.id}] 🚫 Ethical guard violation:`, ethicalCheck.violations);
        return;
      }

      // Simulate execution (in production, this would be real trading)
      const executionResult = await this.simulateExecution(opp);

      // Update profit
      this.profitGenerated += executionResult.profit;
      this.opportunityCount++;

      // Record in audit log
      await this.recordAudit('execution', {
        opportunity: opp,
        profit: executionResult.profit,
        profitabilityScore,
      });

      console.log(`[MICRO-${this.id}] ✅ Execution complete, profit: ${executionResult.profit}`);

    } catch (error) {
      console.error(`[MICRO-${this.id}] ❌ Execution failed:`, error);
    } finally {
      this.status = 'idle';
    }
  }

  // Simulate execution (placeholder for real trading logic)
  private async simulateExecution(opp: Opportunity): Promise<{ profit: number }> {
    // In production, this would execute real trades
    // For now, we simulate with estimated profit
    const actualProfit = opp.profitEstimate * (0.8 + Math.random() * 0.4); // 80-120% of estimate
    
    // Add to running cost
    this.runningCost += 0.001; // $0.001 per execution

    return { profit: actualProfit };
  }

  // Calculate priority score
  private calculatePriorityScore(): number {
    if (!this.target) return 0;

    // Use Eden's priority score calculation
    return eden.calculatePriorityScore(
      this.profitGenerated / Math.max(this.opportunityCount, 1), // avg profit
      0.1, // risk
      100, // latency
      10000 // liquidity
    );
  }

  // Update metrics
  private async updateMetrics(): Promise<void> {
    const state: MicroCrawlerState = {
      id: this.id,
      parentCainId: this.parentCainId,
      mode: this.mode,
      priority: this.priority,
      target: this.target,
      chain: this.chain,
      status: this.status,
      lastActivity: this.lastActivity,
      profitGenerated: this.profitGenerated,
    };

    // In production, persist to database
    // For now, just log
    console.log(`[MICRO-${this.id}] 📊 Metrics updated`);
  }

  // Record audit log
  private async recordAudit(action: string, details: any): Promise<void> {
    // In production, write to eden_audit_log table
    console.log(`[MICRO-${this.id}] 📝 Audit: ${action}`);
  }

  // Get current state
  getState(): MicroCrawlerState {
    return {
      id: this.id,
      parentCainId: this.parentCainId,
      mode: this.mode,
      priority: this.priority,
      target: this.target,
      chain: this.chain,
      status: this.status,
      lastActivity: this.lastActivity,
      profitGenerated: this.profitGenerated,
    };
  }
}
