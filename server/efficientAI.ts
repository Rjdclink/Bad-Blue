/**
 * Efficient AI Service Wrapper
 * Integrates Token Governor and caching to optimize AI usage
 * Used by Worker and Sub-Agent for all AI operations
 */

import {
  getBudgetForTask,
  recordUsage,
  shouldDeferNonCritical,
  AIProvider,
  TaskPriority,
  TaskComplexity,
  UsageContext,
  type AITaskMetadata,
  type TokenBudget,
} from './aiTokenGovernor';
import { getCached, setCached } from './aiCache';
import { getAdaptivePrompt } from './adaptivePrompts';

/**
 * Worker AI operations with integrated efficiency
 */
export const EfficientWorkerAI = {
  /**
   * Architect-level analysis with caching and token budgeting
   */
  async performAnalysis(
    issue: {
      functionAffected: string;
      cause: string;
      severity: number;
      category?: string;
      systemState: string;
    }
  ): Promise<{
    rootCause: string;
    impactAssessment: string;
    riskLevel: string;
    relatedPatterns: string[];
    proposedStrategy: string;
    confidence: number;
  }> {
    const startTime = Date.now();

    // Check if we should defer non-critical analysis
    if (issue.severity <= 2 && await shouldDeferNonCritical()) {
      console.log('[Efficient AI] Deferring non-critical analysis due to tight quotas');
      return {
        rootCause: issue.cause,
        impactAssessment: 'Analysis deferred - API quotas tight',
        riskLevel: 'UNKNOWN',
        relatedPatterns: [],
        proposedStrategy: 'Defer until quotas recover',
        confidence: 0.5,
      };
    }

    // Check cache first
    const cacheKey = {
      function: issue.functionAffected,
      cause: issue.cause,
      severity: issue.severity,
    };

    const cached = await getCached<any>('worker_analysis', {
      taskInputs: cacheKey,
      ttlMinutes: 120, // Cache for 2 hours
    });

    if (cached) {
      console.log('[Efficient AI] Using cached analysis result');
      return cached;
    }

    // Classify task
    const taskMetadata: AITaskMetadata = {
      taskName: 'worker_architect_analysis',
      priority: issue.severity >= 4 ? TaskPriority.MEDIUM_BACKGROUND : TaskPriority.LOW_BACKGROUND,
      complexity: TaskComplexity.MODERATE,
      isUserFacing: false,
      allowDeferral: issue.severity <= 2,
      context: UsageContext.AUTONOMOUS,
    };

    // Get token budget
    const budget = await getBudgetForTask(taskMetadata);

    if (!budget.shouldProceed) {
      console.log(`[Efficient AI] Analysis deferred: ${budget.deferralReason}`);
      return {
        rootCause: issue.cause,
        impactAssessment: 'Analysis deferred',
        riskLevel: 'UNKNOWN',
        relatedPatterns: [],
        proposedStrategy: 'Defer until quotas recover',
        confidence: 0.5,
      };
    }

    // Get adaptive prompt
    const prompt = getAdaptivePrompt('worker', 'diagnostic', budget.verbosityLevel, issue);

    console.log(`[Efficient AI] Analysis with ${budget.provider} (${budget.maxTokens} tokens, ${budget.verbosityLevel})`);

    try {
      // Call AI with provider routing
      let result: any;
      
      if (budget.provider === AIProvider.GROQ) {
        const { generateGroqStructuredResponse } = await import('./groq');
        const response = await generateGroqStructuredResponse(
          prompt,
          'You are an expert system analyst providing architectural insights.'
        );
        result = { analysis: response, response };
      } else {
        const { executeAdvancedReasoning } = await import('./aiSubAgent');
        result = await executeAdvancedReasoning(prompt, false);
      }

      const output = result.analysis || result.response || '';
      const planQuality = result.plan || {};

      // Calculate confidence
      let confidence = 0.75;
      if (planQuality.strategicPlan?.steps?.length > 0) confidence += 0.10;
      if (output.toLowerCase().includes('unknown') || output.toLowerCase().includes('unclear')) confidence -= 0.15;
      if (output.toLowerCase().includes('complex')) confidence -= 0.10;
      confidence = Math.max(0.40, Math.min(0.95, confidence));

      const analysisResult = {
        rootCause: extractSection(output, 'ROOT CAUSE') || issue.cause,
        impactAssessment: extractSection(output, 'IMPACT') || 'Unknown impact',
        riskLevel: extractSection(output, 'RISK') || 'MODERATE',
        relatedPatterns: extractPatterns(output),
        proposedStrategy: extractSection(output, 'STRATEG') || 'Direct repair',
        confidence,
      };

      // Record usage
      const latency = Date.now() - startTime;
      await recordUsage(
        taskMetadata.taskName,
        budget.provider,
        estimateTokens(output),
        latency,
        true,
        budget.verbosityLevel,
        taskMetadata.priority
      );

      // Cache result
      await setCached('worker_analysis', analysisResult, {
        taskInputs: cacheKey,
        ttlMinutes: 120,
      });

      return analysisResult;
    } catch (error: any) {
      console.error('[Efficient AI] Analysis error:', error.message);
      
      // Record failure
      await recordUsage(
        taskMetadata.taskName,
        budget.provider,
        0,
        Date.now() - startTime,
        false,
        budget.verbosityLevel,
        taskMetadata.priority
      );

      return {
        rootCause: issue.cause,
        impactAssessment: 'Analysis failed',
        riskLevel: 'HIGH',
        relatedPatterns: [],
        proposedStrategy: 'Escalate to Sub-Agent',
        confidence: 0.30,
      };
    }
  },

  /**
   * Database health check with lightweight AI analysis
   */
  async checkDatabaseHealth(): Promise<{ status: string; issues: string[]; recommendations: string[] }> {
    // Check if should defer
    if (await shouldDeferNonCritical()) {
      return {
        status: 'unknown',
        issues: ['Analysis deferred - API quotas tight'],
        recommendations: [],
      };
    }

    // Check cache
    const cached = await getCached<any>('db_health_check', { ttlMinutes: 30 });
    if (cached) {
      return cached;
    }

    const taskMetadata: AITaskMetadata = {
      taskName: 'worker_db_health',
      priority: TaskPriority.LOW_BACKGROUND,
      complexity: TaskComplexity.LIGHTWEIGHT,
      isUserFacing: false,
      allowDeferral: true,
      context: UsageContext.AUTONOMOUS,
    };

    const budget = await getBudgetForTask(taskMetadata);
    if (!budget.shouldProceed) {
      return {
        status: 'deferred',
        issues: [],
        recommendations: [],
      };
    }

    const prompt = getAdaptivePrompt('worker', 'database_health', budget.verbosityLevel);

    try {
      const { generateGroqStructuredResponse } = await import('./groq');
      const response = await generateGroqStructuredResponse(
        prompt,
        'You are a database health monitoring expert.'
      );
      const healthResult = {
        status: response.includes('healthy') || response.includes('operational') ? 'healthy' : 'degraded',
        issues: extractList(response, 'issue'),
        recommendations: extractList(response, 'recommend'),
      };

      await recordUsage(taskMetadata.taskName, AIProvider.GROQ, estimateTokens(response), 0, true, budget.verbosityLevel, taskMetadata.priority);
      await setCached('db_health_check', healthResult, { ttlMinutes: 30 });

      return healthResult;
    } catch (error) {
      return {
        status: 'error',
        issues: ['Health check failed'],
        recommendations: [],
      };
    }
  },
};

/**
 * User-facing AI operations (always prioritized)
 */
export const EfficientUserAI = {
  /**
   * Legal consultation with dynamic token allocation
   */
  async legalConsultation(question: string, maxComplexity: TaskComplexity = TaskComplexity.COMPREHENSIVE): Promise<string> {
    const taskMetadata: AITaskMetadata = {
      taskName: 'legal_consultation',
      priority: TaskPriority.CRITICAL_USER,
      complexity: maxComplexity,
      isUserFacing: true,
      allowDeferral: false, // Never defer user requests
      context: UsageContext.USER,
    };

    const budget = await getBudgetForTask(taskMetadata);
    const prompt = getAdaptivePrompt('user', 'legal_consultation', budget.verbosityLevel, question);

    console.log(`[Efficient AI] Legal consultation with ${budget.provider} (${budget.maxTokens} tokens)`);

    const startTime = Date.now();

    try {
      let response: string;
      
      if (budget.provider === AIProvider.GROQ) {
        const { generateGroqLegalConsultation } = await import('./groq');
        response = await generateGroqLegalConsultation(question);
      } else {
        const { analyzeLegalIssue } = await import('./legalAI');
        response = await analyzeLegalIssue('User Question', 'General', question);
      }
      
      await recordUsage(
        taskMetadata.taskName,
        budget.provider,
        estimateTokens(response),
        Date.now() - startTime,
        true,
        budget.verbosityLevel,
        taskMetadata.priority
      );

      return response;
    } catch (error: any) {
      await recordUsage(taskMetadata.taskName, budget.provider, 0, Date.now() - startTime, false, budget.verbosityLevel, taskMetadata.priority);
      throw error;
    }
  },
};

/**
 * Helper: Extract section from AI response
 */
function extractSection(text: string, sectionName: string): string | null {
  const pattern = new RegExp(`${sectionName}[:\\s]+(.*?)(?=\\n\\n|$)`, 'is');
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Helper: Extract patterns from text
 */
function extractPatterns(text: string): string[] {
  const patternSection = extractSection(text, 'PATTERN');
  if (!patternSection) return [];
  
  return patternSection
    .split(/[,\n]/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .slice(0, 5);
}

/**
 * Helper: Extract list items from text
 */
function extractList(text: string, keyword: string): string[] {
  const lines = text.split('\n');
  return lines
    .filter(line => line.toLowerCase().includes(keyword))
    .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(item => item.length > 0)
    .slice(0, 10);
}

/**
 * Helper: Estimate token count from text
 */
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}
