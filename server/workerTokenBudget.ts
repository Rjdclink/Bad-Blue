import { tokenMetricsRepository } from './repositories/tokenMetricsRepository';

/**
 * Worker Token Budget Manager
 * 
 * Worker/autonomous operations use Groq exclusively with no limits.
 * All Groq capacity is available for both user and worker operations.
 */
export class WorkerTokenBudget {
  // Token estimation ceilings (for logging purposes only, not enforcement)
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
   * Returns Infinity - no limits on worker operations
   */
  async getRemainingBudget(): Promise<number> {
    console.log(`[Worker Budget] Unlimited Groq access for worker operations`);
    return Infinity;
  }

  /**
   * Check if Worker can run an operation
   * Always returns true - no limits
   */
  async canRunOperation(operationName: string, estimatedTokens?: number): Promise<boolean> {
    console.log(`[Worker Budget] ✓ Operation '${operationName}' allowed (no limits)`);
    return true;
  }

  /**
   * Reserve budget for an operation (optimistic locking)
   * Always succeeds - no limits
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
        source: 'worker',
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
      budget: Infinity,
      remaining: Infinity,
      percentUsed: 0, // Always 0% since unlimited
    };
  }

  /**
   * Estimate tokens for an operation using historical averages
   */
  async estimateTokens(operationName: string): Promise<number> {
    try {
      const average = await tokenMetricsRepository.getMovingAverage(operationName, 7);
      
      if (average > 0) {
        const conservative = average * 1.25;
        const staticEstimate = this.TOKEN_ESTIMATES[operationName as keyof typeof this.TOKEN_ESTIMATES] || 5000;
        return Math.max(conservative, staticEstimate);
      }
    } catch (error) {
      console.warn('[Worker Budget] Error fetching historical average:', error);
    }
    
    return this.TOKEN_ESTIMATES[operationName as keyof typeof this.TOKEN_ESTIMATES] || 5000;
  }
}

// Export singleton instance
export const workerTokenBudget = new WorkerTokenBudget();
