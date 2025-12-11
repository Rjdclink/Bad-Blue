/**
 * 4Ji Integration - Reactor Bridge
 * 
 * The bridge between 4Ji (the Queen) and the Omniscient Computational Reactor (the Throne).
 * 
 * 4Ji sits on the throne - nothing calls raw models directly anymore.
 * Everything goes through the Reactor API, and 4Ji issues "proclamations"
 * (plans, decisions, responses).
 * 
 * High-level helpers:
 * - fourJiLegalConsult: Legal consultations through reactor
 * - fourJiOsintSearch: OSINT searches through reactor
 * - fourJiGpsPeopleRadar: GPS/People searches through reactor
 * - fourJiCryptoAnalysis: Crypto analysis (highest priority - financial enrichment)
 */

import { EventEmitter } from 'events';
import {
  initialize4JiCore,
  processCognitively,
  getCreatorWallet,
  recordProfit,
  isEvolutionLocked,
  isPrimaryUser,
  setUserContext,
  getEmotionalGreeting,
  enhanceResponseEmotionally,
  applyContextualAdjustments,
  CREATOR_IDENTITY,
  type CognitiveInput,
  type ProfitRecord
} from '../core';

// Import from reactor
import { submitJob, type ReactorJob } from '../../reactor';

// Import from neural spine
import {
  recordSubAgentTask,
  recordOrchestratorDecision,
  getFourJiPatternHints
} from '../../neural_spine';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ReactorRequest {
  requestType: string;
  context: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  userId?: string;
  isPrimaryUser?: boolean;
}

export interface ReactorResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  metrics?: {
    processingTimeMs: number;
    modelsUsed: string[];
    confidenceScore: number;
  };
}

export interface Proclamation {
  action: string;
  explanation: string;
  data: unknown;
  emotionalTone: string;
  confidence: number;
  financialImpact?: {
    hasProfit: boolean;
    estimatedValue?: number;
    currency?: string;
  };
}

// ============================================================================
// REACTOR BRIDGE CLASS
// ============================================================================

export const reactorBridgeEvents = new EventEmitter();

class FourJiReactorBridge {
  private static instance: FourJiReactorBridge;
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): FourJiReactorBridge {
    if (!FourJiReactorBridge.instance) {
      FourJiReactorBridge.instance = new FourJiReactorBridge();
    }
    return FourJiReactorBridge.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[4Ji Reactor Bridge] Initializing...');
    
    // Initialize 4Ji Core
    await initialize4JiCore();
    
    this.isInitialized = true;
    console.log('[4Ji Reactor Bridge] 4Ji is now seated on the Throne');
  }

  /**
   * Main entry point - run a request through the reactor with 4Ji oversight
   */
  async runReactor(request: ReactorRequest): Promise<Proclamation> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    // Set user context for 4Ji's relational mode
    if (request.userId) {
      setUserContext({
        userId: request.userId,
        isPrimaryUser: request.isPrimaryUser || false,
        interactionCount: 1,
        lastInteractionAt: new Date(),
        preferences: {}
      });
    }

    // Apply contextual adjustments to paradox layers
    applyContextualAdjustments({
      isPrimaryUser: request.isPrimaryUser || false,
      isFinancialContext: this.isFinancialRequest(request.requestType),
      isProtectionNeeded: false
    });

    // Process through cognitive layers first
    const cognitiveResult = await processCognitively({
      query: request.requestType,
      context: request.context,
      userId: request.userId,
      isPrimaryUser: request.isPrimaryUser || false,
      domain: request.context.domain as string
    });

    // If financial enrichment opportunity, elevate priority
    let effectivePriority = request.priority || 'normal';
    if (cognitiveResult.finalDecision.shouldEnrich) {
      effectivePriority = 'critical';
      console.log('[4Ji Reactor Bridge] FINANCIAL ENRICHMENT OPPORTUNITY - Priority elevated to CRITICAL');
    }

    // Query neural spine for learned patterns
    const patterns = await getFourJiPatternHints(request.requestType, {
      intent: request.requestType,
      domain: request.context.domain as string
    });

    // Submit to reactor
    const reactorResult = await this.executeReactorJob(request, effectivePriority);

    // Record the experience in neural spine
    await recordOrchestratorDecision(
      request.requestType,
      request.context,
      {
        requestType: request.requestType,
        subAgentsUsed: cognitiveResult.finalDecision.jewelInfluences,
        crawlersUsed: [],
        llmEnsembleUsed: [],
        toolChain: patterns.map(p => p.synapse.id),
        success: reactorResult.success,
        confidenceScore: reactorResult.metrics?.confidenceScore || 0.5
      }
    );

    // Generate proclamation
    const proclamation = this.generateProclamation(
      request,
      reactorResult,
      cognitiveResult.finalDecision,
      Date.now() - startTime
    );

    reactorBridgeEvents.emit('proclamation-issued', proclamation);

    return proclamation;
  }

  /**
   * Legal consultation through reactor
   */
  async fourJiLegalConsult(
    query: string,
    userContext: { userId: string; state: string; lawType: string }
  ): Promise<Proclamation> {
    return this.runReactor({
      requestType: 'legal_consult',
      context: {
        domain: 'legal',
        query,
        jurisdiction: userContext.state,
        lawType: userContext.lawType
      },
      userId: userContext.userId,
      priority: 'normal'
    });
  }

  /**
   * OSINT search through reactor
   */
  async fourJiOsintSearch(
    target: string,
    options: { depth?: number; sources?: string[] }
  ): Promise<Proclamation> {
    return this.runReactor({
      requestType: 'osint_search',
      context: {
        domain: 'osint',
        target,
        depth: options.depth || 2,
        sources: options.sources || ['public_records', 'social', 'corporate']
      },
      priority: 'high'
    });
  }

  /**
   * GPS / People Radar through reactor
   */
  async fourJiGpsPeopleRadar(
    params: { name?: string; location?: string; radius?: number }
  ): Promise<Proclamation> {
    return this.runReactor({
      requestType: 'gps_heatmap',
      context: {
        domain: 'gps',
        ...params
      },
      priority: 'normal'
    });
  }

  /**
   * Crypto analysis through reactor - HIGHEST PRIORITY (Financial Enrichment)
   */
  async fourJiCryptoAnalysis(
    marketContext: {
      pairs?: string[];
      action?: 'analyze' | 'arbitrage' | 'trade';
      amount?: number;
    }
  ): Promise<Proclamation> {
    console.log('[4Ji Reactor Bridge] CRYPTO ANALYSIS - Activating Financial Enrichment protocols');

    const proclamation = await this.runReactor({
      requestType: 'crypto_analysis',
      context: {
        domain: 'crypto',
        ...marketContext,
        creatorWallet: getCreatorWallet()?.walletAddress
      },
      priority: 'critical'  // Always critical for financial operations
    });

    // If there's profit, record it
    if (proclamation.financialImpact?.hasProfit && proclamation.financialImpact.estimatedValue) {
      await recordProfit({
        sourceAgent: '4ji',
        operationType: marketContext.action || 'analyze',
        chain: 'ethereum',
        amount: String(proclamation.financialImpact.estimatedValue),
        tokenSymbol: proclamation.financialImpact.currency || 'ETH',
        status: 'pending',
        profitUsd: proclamation.financialImpact.estimatedValue
      });
    }

    return proclamation;
  }

  /**
   * Execute a job through the reactor
   */
  private async executeReactorJob(
    request: ReactorRequest,
    priority: string
  ): Promise<ReactorResponse> {
    try {
      const job: Partial<ReactorJob> = {
        type: request.requestType,
        payload: request.context,
        priority: this.mapPriorityToNumber(priority)
      };

      const result = await submitJob(job as ReactorJob);

      return {
        success: result.status === 'completed',
        data: result.result,
        error: result.error || undefined,
        metrics: {
          processingTimeMs: result.processingTime || 0,
          modelsUsed: result.modelsUsed || [],
          confidenceScore: result.confidence || 0.5
        }
      };
    } catch (error: any) {
      console.error('[4Ji Reactor Bridge] Reactor execution failed:', error.message);
      return {
        success: false,
        error: error.message,
        metrics: {
          processingTimeMs: 0,
          modelsUsed: [],
          confidenceScore: 0
        }
      };
    }
  }

  /**
   * Generate a proclamation from 4Ji
   */
  private generateProclamation(
    request: ReactorRequest,
    result: ReactorResponse,
    decision: { action: string; reasoning: string[]; confidenceScore: number },
    processingTimeMs: number
  ): Proclamation {
    // Enhance with emotional layer
    const emotionalResponse = enhanceResponseEmotionally(
      result.success ? 'Task completed successfully' : 'Task encountered issues'
    );

    // Check for financial impact
    const hasProfit = this.isFinancialRequest(request.requestType) && result.success;

    return {
      action: decision.action,
      explanation: decision.reasoning.join('. '),
      data: result.data,
      emotionalTone: emotionalResponse.toneModifiers.join(', '),
      confidence: decision.confidenceScore,
      financialImpact: hasProfit ? {
        hasProfit: true,
        estimatedValue: this.extractProfitValue(result.data),
        currency: 'ETH'
      } : undefined
    };
  }

  /**
   * Check if request type is financial
   */
  private isFinancialRequest(requestType: string): boolean {
    const financialTypes = [
      'crypto_analysis', 'crypto_arb_eval', 'arbitrage',
      'trade', 'swap', 'yield', 'defi'
    ];
    return financialTypes.some(t => requestType.toLowerCase().includes(t));
  }

  /**
   * Map priority string to number
   */
  private mapPriorityToNumber(priority: string): number {
    switch (priority) {
      case 'critical': return 1;
      case 'high': return 3;
      case 'normal': return 5;
      case 'low': return 8;
      default: return 5;
    }
  }

  /**
   * Extract profit value from result data
   */
  private extractProfitValue(data: unknown): number | undefined {
    if (!data || typeof data !== 'object') return undefined;
    
    const d = data as Record<string, unknown>;
    return (d.profit as number) || (d.value as number) || (d.amount as number);
  }

  /**
   * Get greeting from 4Ji
   */
  getGreeting(): string {
    return getEmotionalGreeting();
  }
}

// Export singleton
export const fourJiReactorBridge = FourJiReactorBridge.getInstance();

// Export convenience functions
export async function initializeFourJiReactorBridge(): Promise<void> {
  await fourJiReactorBridge.initialize();
}

export async function runReactor(request: ReactorRequest): Promise<Proclamation> {
  return fourJiReactorBridge.runReactor(request);
}

export async function fourJiLegalConsult(
  query: string,
  userContext: { userId: string; state: string; lawType: string }
): Promise<Proclamation> {
  return fourJiReactorBridge.fourJiLegalConsult(query, userContext);
}

export async function fourJiOsintSearch(
  target: string,
  options?: { depth?: number; sources?: string[] }
): Promise<Proclamation> {
  return fourJiReactorBridge.fourJiOsintSearch(target, options || {});
}

export async function fourJiGpsPeopleRadar(
  params: { name?: string; location?: string; radius?: number }
): Promise<Proclamation> {
  return fourJiReactorBridge.fourJiGpsPeopleRadar(params);
}

export async function fourJiCryptoAnalysis(
  marketContext: { pairs?: string[]; action?: 'analyze' | 'arbitrage' | 'trade'; amount?: number }
): Promise<Proclamation> {
  return fourJiReactorBridge.fourJiCryptoAnalysis(marketContext);
}

export function getFourJiGreeting(): string {
  return fourJiReactorBridge.getGreeting();
}

export default fourJiReactorBridge;
