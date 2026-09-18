import { tokenMetricsRepository } from './repositories/tokenMetricsRepository';

/**
 * Worker Token Budget Manager
 * 
 * Enforces strict 15% Groq daily quota limit for Worker operations
 * Ensures user requests always have ≥85% of quota available
 */
export class WorkerTokenBudget {
  // Groq API daily limits
  private readonly DAILY_GROQ_QUOTA = 100000; // tokens/day
  private readonly WORKER_PERCENTAGE = 0.15;  // 15% cap
  private readonly WORKER_DAILY_BUDGET = 15000; // 15% of 100k tokens
  
  // Token estimation ceilings (conservative)
  private readonly TOKEN_ESTIMATES = {
    'precedent_search': 5000,
    'filing_info_search': 3000,
    'legal_ai_analysis': 6000,
    'document_generation': 4000,
    'tort_notice_generation': 3500,
    'ai_services_test': 1000,
    'lightweight_diagnostic': 2000,
  };

  /**
   * Get remaining Worker budget for today (UTC)
   */
  async getRemainingBudget(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Query total worker usage for today
      const usageToday = await tokenMetricsRepository.getUsageBySource('worker', today);
      const used = usageToday.totalTokens || 0;
      
      const remaining = Math.max(0, this.WORKER_DAILY_BUDGET - used);
      
      console.log(`[Worker Budget] Today: ${used}/${this.WORKER_DAILY_BUDGET} tokens used (${remaining} remaining)`);
      
      return remaining;
    } catch (error) {
      console.warn('[Worker Budget] Error fetching usage, assuming 0 budget:', error);
      return 0; // Fail-safe: deny budget if can't verify usage
    }
  }

  /**
   * Check if Worker can run an operation
   */
  async canRunOperation(operationName: string, estimatedTokens?: number): Promise<boolean> {
    const remaining = await this.getRemainingBudget();
    
    // Use provided estimate or lookup default
    const estimate = estimatedTokens || this.TOKEN_ESTIMATES[operationName as keyof typeof this.TOKEN_ESTIMATES] || 5000;
    
    const allowed = remaining >= estimate;
    
    if (!allowed) {
      console.log(`[Worker Budget] ⛔ Operation '${operationName}' denied (needs ${estimate} tokens, only ${remaining} remaining)`);
    }
    
    return allowed;
  }

  /**
   * Reserve budget for an operation (optimistic locking)
   * Returns reservation ID if successful, null if budget exhausted
   */
  async reserveBudget(operationName: string, estimatedTokens?: number): Promise<string | null> {
    const allowed = await this.canRunOperation(operationName, estimatedTokens);
    
    if (!allowed) {
      return null;
    }
    
    // Generate reservation ID
    const reservationId = `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[Worker Budget] ✓ Reserved budget for '${operationName}' (reservation: ${reservationId})`);
    
    return reservationId;
  }

  /**
   * Commit actual usage after operation completes
   */
  async commitUsage(
    operationName: string,
    actualTokens: number,
    reservationId?: string
  ): Promise<void> {
    try {
      await tokenMetricsRepository.recordUsage({
        provider: 'groq',
        model: process.env.GROQ_CHAT_MODEL?.trim() || process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b',
        tokensUsed: actualTokens,
        source: 'worker', // Tag as worker usage
        operation: operationName,
        timestamp: new Date(),
      });
      
      console.log(`[Worker Budget] Committed ${actualTokens} tokens for '${operationName}'`);
    } catch (error) {
      console.error('[Worker Budget] Error committing usage:', error);
    }
  }

  /**
   * Get usage statistics for today
   */
  async getTodayStats(): Promise<{
    used: number;
    budget: number;
    remaining: number;
    percentUsed: number;
  }> {
    const today = new Date().toISOString().split('T')[0];
    const usageToday = await tokenMetricsRepository.getUsageBySource('worker', today);
    const used = usageToday.totalTokens || 0;
    const remaining = Math.max(0, this.WORKER_DAILY_BUDGET - used);
    const percentUsed = (used / this.WORKER_DAILY_BUDGET) * 100;
    
    return {
      used,
      budget: this.WORKER_DAILY_BUDGET,
      remaining,
      percentUsed,
    };
  }

  /**
   * Estimate tokens for an operation using historical averages
   */
  async estimateTokens(operationName: string): Promise<number> {
    try {
      // Get moving average from last 7 days
      const average = await tokenMetricsRepository.getMovingAverage(operationName, 7);
      
      if (average > 0) {
        // Use max(estimate, average * 1.25) to prevent underestimation
        const conservative = average * 1.25;
        const staticEstimate = this.TOKEN_ESTIMATES[operationName as keyof typeof this.TOKEN_ESTIMATES] || 5000;
        
        return Math.max(conservative, staticEstimate);
      }
    } catch (error) {
      console.warn('[Worker Budget] Error fetching historical average:', error);
    }
    
    // Fall back to static estimate
    return this.TOKEN_ESTIMATES[operationName as keyof typeof this.TOKEN_ESTIMATES] || 5000;
  }
}

// Export singleton instance
export const workerTokenBudget = new WorkerTokenBudget();
