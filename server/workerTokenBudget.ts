import { tokenMetricsRepository } from './repositories/tokenMetricsRepository';

/**
 * Worker Token Budget Manager
 * 
 * Worker/autonomous operations use Groq exclusively with no limits.
 * All Groq capacity is available for both user and worker operations.
 */
export class WorkerTokenBudget {
  // Token estimation ceilings (conservative) - kept for reference/logging only
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
    // No limits - workers can use unlimited Groq tokens
    console.log(`[Worker Budget] Unlimited Groq access for worker operations`);
    return Number.MAX_SAFE_INTEGER;
  }

  /**
   * Check if Worker can run an operation
   */
  async canRunOperation(operationName: string, estimatedTokens?: number): Promise<boolean> {
    // No limits - all operations allowed
    console.log(`[Worker Budget] ✓ Operation '${operationName}' allowed (no limits)`);
    return true;
  }

  /**
   * Reserve budget for an operation (optimistic locking)
   * Returns reservation ID if successful, null if budget exhausted
   */
  async reserveBudget(operationName: string, estimatedTokens?: number): Promise<string | null> {
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
        model: 'llama-3.3-70b-versatile',
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
    
    return {
      used,
      budget: Number.MAX_SAFE_INTEGER,
      remaining: Number.MAX_SAFE_INTEGER,
      percentUsed: 0, // Always 0% since unlimited
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
