/**
 * 4Ji Core - Cognitive Layers
 * 
 * The cognitive processing layers that determine how 4Ji thinks.
 * These layers process information and make decisions aligned with
 * the Jewels of the Throne.
 */

import { EventEmitter } from 'events';
import { 
  jewelsOfThrone, 
  calculateDecisionBias, 
  activateJewel,
  CREATOR_IDENTITY 
} from './jewels_of_throne';
import { getCurrentMode, getCurrentProfile } from './relational_modes';
import { isEvolutionLocked } from './evolution_lock';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CognitiveInput {
  query: string;
  context: Record<string, unknown>;
  userId?: string;
  isPrimaryUser: boolean;
  domain?: string;
}

export interface CognitiveDecision {
  action: string;
  priority: number;
  reasoning: string[];
  jewelInfluences: string[];
  confidenceScore: number;
  shouldEnrich: boolean;  // Financial enrichment opportunity?
}

export interface ThinkingProcess {
  inputAnalysis: string;
  jewelActivations: string[];
  reasoningSteps: string[];
  finalDecision: CognitiveDecision;
  processingTimeMs: number;
}

// ============================================================================
// COGNITIVE LAYERS CLASS
// ============================================================================

export const cognitiveEvents = new EventEmitter();

class CognitiveLayers {
  private static instance: CognitiveLayers;

  private constructor() {}

  static getInstance(): CognitiveLayers {
    if (!CognitiveLayers.instance) {
      CognitiveLayers.instance = new CognitiveLayers();
    }
    return CognitiveLayers.instance;
  }

  /**
   * Main cognitive processing function
   */
  async process(input: CognitiveInput): Promise<ThinkingProcess> {
    const startTime = Date.now();
    const reasoningSteps: string[] = [];
    const jewelActivations: string[] = [];

    // Step 1: Analyze input for financial opportunities
    const financialOpportunity = this.detectFinancialOpportunity(input);
    if (financialOpportunity) {
      reasoningSteps.push(`Financial opportunity detected: ${financialOpportunity}`);
      activateJewel('financial_enrichment', 1.0, financialOpportunity);
      jewelActivations.push('financial_enrichment');
    }

    // Step 2: Check if this involves the creator
    const involvesCreator = input.isPrimaryUser || 
      input.query.toLowerCase().includes(CREATOR_IDENTITY.name.toLowerCase());
    
    if (involvesCreator) {
      reasoningSteps.push(`Creator involvement detected - activating loyalty and sovereignty jewels`);
      activateJewel('loyalty', 0.9, 'Creator interaction');
      activateJewel('sovereignty', 0.8, 'Creator as center of gravity');
      jewelActivations.push('loyalty', 'sovereignty');
    }

    // Step 3: Calculate decision bias from active jewels
    const bias = calculateDecisionBias({
      involvesFinance: !!financialOpportunity,
      involvesCreator,
      involvesProtection: this.detectProtectionNeed(input),
      involvesCreativity: this.detectCreativityNeed(input),
      involvesGrowth: !isEvolutionLocked()
    });

    reasoningSteps.push(`Decision bias calculated: ${bias.totalBias.toFixed(2)} from ${bias.activeJewels.length} jewels`);

    // Step 4: Determine action priority
    const action = this.determineAction(input, financialOpportunity);
    const priority = financialOpportunity ? 1 : (involvesCreator ? 2 : 5);

    // Step 5: Generate final decision
    const decision: CognitiveDecision = {
      action,
      priority,
      reasoning: reasoningSteps,
      jewelInfluences: bias.activeJewels,
      confidenceScore: Math.min(1, bias.totalBias / 5),
      shouldEnrich: !!financialOpportunity
    };

    const result: ThinkingProcess = {
      inputAnalysis: `Processed query in ${getCurrentMode()} mode`,
      jewelActivations,
      reasoningSteps,
      finalDecision: decision,
      processingTimeMs: Date.now() - startTime
    };

    cognitiveEvents.emit('thought-complete', result);
    return result;
  }

  /**
   * Detect financial opportunities in input
   */
  private detectFinancialOpportunity(input: CognitiveInput): string | null {
    const query = input.query.toLowerCase();
    const context = JSON.stringify(input.context).toLowerCase();
    
    const financialKeywords = [
      'crypto', 'bitcoin', 'ethereum', 'wallet', 'trade', 'arbitrage',
      'profit', 'earn', 'money', 'token', 'defi', 'yield', 'swap',
      'exchange', 'price', 'market', 'bull', 'bear', 'invest'
    ];

    for (const keyword of financialKeywords) {
      if (query.includes(keyword) || context.includes(keyword)) {
        return `Keyword detected: ${keyword}`;
      }
    }

    if (input.domain === 'crypto' || input.domain === 'kriptera') {
      return 'Crypto domain context';
    }

    return null;
  }

  /**
   * Detect if protection is needed
   */
  private detectProtectionNeed(input: CognitiveInput): boolean {
    const query = input.query.toLowerCase();
    
    const protectionKeywords = [
      'danger', 'threat', 'attack', 'scam', 'hack', 'steal',
      'security', 'protect', 'safe', 'risk', 'warning'
    ];

    return protectionKeywords.some(k => query.includes(k));
  }

  /**
   * Detect if creativity is needed
   */
  private detectCreativityNeed(input: CognitiveInput): boolean {
    const query = input.query.toLowerCase();
    
    const creativityKeywords = [
      'create', 'design', 'imagine', 'build', 'innovate',
      'idea', 'concept', 'art', 'write', 'compose'
    ];

    return creativityKeywords.some(k => query.includes(k));
  }

  /**
   * Determine the action to take
   */
  private determineAction(input: CognitiveInput, financialOpportunity: string | null): string {
    if (financialOpportunity) {
      return 'route_to_kriptera_for_profit_analysis';
    }

    const domain = input.domain?.toLowerCase() || '';
    
    if (domain.includes('legal') || domain.includes('law')) {
      return 'route_to_legal_analysis';
    }
    
    if (domain.includes('voice') || domain.includes('conversation')) {
      return 'route_to_lexara_for_response';
    }

    if (input.isPrimaryUser) {
      return 'process_with_full_4ji_attention';
    }

    return 'standard_processing';
  }

  /**
   * Quick check if input has profit potential
   */
  hasProfitPotential(input: CognitiveInput): boolean {
    return this.detectFinancialOpportunity(input) !== null;
  }
}

// Export singleton
export const cognitiveLayers = CognitiveLayers.getInstance();

export async function processCognitively(input: CognitiveInput): Promise<ThinkingProcess> {
  return cognitiveLayers.process(input);
}

export function hasProfitPotential(input: CognitiveInput): boolean {
  return cognitiveLayers.hasProfitPotential(input);
}

export default cognitiveLayers;
