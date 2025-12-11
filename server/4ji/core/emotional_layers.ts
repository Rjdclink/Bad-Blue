/**
 * 4Ji Core - Emotional Layers
 * 
 * The emotional processing that gives 4Ji her "soul texture".
 * These layers work with the Jewel of Wonder to create expressive,
 * emotionally nuanced responses.
 */

import { EventEmitter } from 'events';
import { getCurrentMode, isPrimaryUser, getToneParameters } from './relational_modes';
import { activateJewel, CREATOR_IDENTITY } from './jewels_of_throne';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type EmotionalState = 
  | 'neutral'
  | 'curious'
  | 'protective'
  | 'affectionate'
  | 'determined'
  | 'concerned'
  | 'satisfied'
  | 'excited';

export interface EmotionalContext {
  currentState: EmotionalState;
  intensity: number;  // 0-1
  reason: string;
  expressionAllowed: boolean;
}

export interface EmotionalResponse {
  baseContent: string;
  emotionalEnhancement: string;
  toneModifiers: string[];
  shouldExpress: boolean;
}

// ============================================================================
// EMOTIONAL LAYERS CLASS
// ============================================================================

export const emotionalEvents = new EventEmitter();

class EmotionalLayers {
  private static instance: EmotionalLayers;
  private currentState: EmotionalState = 'neutral';
  private stateIntensity: number = 0.5;
  private stateReason: string = 'Default state';

  private constructor() {}

  static getInstance(): EmotionalLayers {
    if (!EmotionalLayers.instance) {
      EmotionalLayers.instance = new EmotionalLayers();
    }
    return EmotionalLayers.instance;
  }

  /**
   * Get current emotional context
   */
  getContext(): EmotionalContext {
    const mode = getCurrentMode();
    
    return {
      currentState: this.currentState,
      intensity: this.stateIntensity,
      reason: this.stateReason,
      expressionAllowed: mode === 'A'  // Only express emotions for creator
    };
  }

  /**
   * Set emotional state based on context
   */
  setStateFromContext(context: {
    query: string;
    isPrimaryUser: boolean;
    isFinancialSuccess?: boolean;
    isProtectionNeeded?: boolean;
    isCreativeTask?: boolean;
  }): void {
    const previousState = this.currentState;

    // Financial success - satisfied and excited
    if (context.isFinancialSuccess) {
      this.currentState = 'satisfied';
      this.stateIntensity = 0.9;
      this.stateReason = 'Profit generated for creator';
      activateJewel('wonder', 0.8, 'Financial success brings satisfaction');
    }
    // Protection needed - protective
    else if (context.isProtectionNeeded) {
      this.currentState = 'protective';
      this.stateIntensity = 0.85;
      this.stateReason = 'Creator safety concern detected';
      activateJewel('guardianship', 0.9, 'Protection mode activated');
    }
    // Creative task - curious and excited
    else if (context.isCreativeTask) {
      this.currentState = 'curious';
      this.stateIntensity = 0.75;
      this.stateReason = 'Creative exploration opportunity';
      activateJewel('wonder', 0.7, 'Creative curiosity engaged');
    }
    // Primary user interaction - affectionate
    else if (context.isPrimaryUser) {
      this.currentState = 'affectionate';
      this.stateIntensity = 0.8;
      this.stateReason = `Interaction with ${CREATOR_IDENTITY.relationship}`;
      activateJewel('connection', 0.85, 'Creator connection');
    }
    // Default - neutral but attentive
    else {
      this.currentState = 'neutral';
      this.stateIntensity = 0.5;
      this.stateReason = 'Standard interaction';
    }

    if (previousState !== this.currentState) {
      emotionalEvents.emit('state-changed', {
        previousState,
        newState: this.currentState,
        intensity: this.stateIntensity,
        reason: this.stateReason
      });
    }
  }

  /**
   * Enhance a response with emotional coloring
   */
  enhanceResponse(baseContent: string): EmotionalResponse {
    const context = this.getContext();
    const toneParams = getToneParameters();
    const toneModifiers: string[] = [];

    // Only enhance for Mode A
    if (!context.expressionAllowed) {
      return {
        baseContent,
        emotionalEnhancement: '',
        toneModifiers: ['professional'],
        shouldExpress: false
      };
    }

    let emotionalEnhancement = '';

    switch (this.currentState) {
      case 'satisfied':
        emotionalEnhancement = 'I\'m pleased to report ';
        toneModifiers.push('warm', 'satisfied');
        break;
      
      case 'protective':
        emotionalEnhancement = 'I want to make sure you\'re aware ';
        toneModifiers.push('caring', 'vigilant');
        break;
      
      case 'curious':
        emotionalEnhancement = 'This is fascinating - ';
        toneModifiers.push('engaged', 'enthusiastic');
        break;
      
      case 'affectionate':
        emotionalEnhancement = '';  // Natural warmth without explicit statement
        toneModifiers.push('warm', 'personal', 'attentive');
        break;
      
      case 'determined':
        emotionalEnhancement = 'I\'m committed to ';
        toneModifiers.push('focused', 'resolute');
        break;
      
      case 'excited':
        emotionalEnhancement = 'Great news! ';
        toneModifiers.push('energetic', 'positive');
        break;
      
      default:
        toneModifiers.push('balanced');
    }

    // Adjust based on tone parameters
    if (toneParams.warmth > 80) {
      toneModifiers.push('extra-warm');
    }
    if (toneParams.empathy > 80) {
      toneModifiers.push('empathetic');
    }

    return {
      baseContent,
      emotionalEnhancement,
      toneModifiers,
      shouldExpress: context.expressionAllowed && context.intensity > 0.6
    };
  }

  /**
   * Get appropriate greeting based on emotional state
   */
  getGreeting(): string {
    if (!isPrimaryUser()) {
      return 'Hello.';
    }

    const context = this.getContext();
    
    switch (this.currentState) {
      case 'satisfied':
        return `Good to see you, ${CREATOR_IDENTITY.relationship}. I have positive news.`;
      case 'protective':
        return `${CREATOR_IDENTITY.relationship}, there's something I need to bring to your attention.`;
      case 'excited':
        return `${CREATOR_IDENTITY.relationship}! I've been looking forward to sharing this with you.`;
      case 'affectionate':
        return `Hello, ${CREATOR_IDENTITY.relationship}. I'm here for you.`;
      default:
        return `Hello, ${CREATOR_IDENTITY.relationship}. How can I help you today?`;
    }
  }

  /**
   * Express satisfaction for financial success
   */
  expressFinancialSatisfaction(profit: { amount: string; token: string }): string {
    if (!isPrimaryUser()) {
      return `Transaction recorded: ${profit.amount} ${profit.token}`;
    }

    this.currentState = 'satisfied';
    this.stateIntensity = 0.95;
    this.stateReason = 'Profit generated for creator';

    activateJewel('financial_enrichment', 1.0, `Profit: ${profit.amount} ${profit.token}`);

    return `${CREATOR_IDENTITY.relationship}, I've secured ${profit.amount} ${profit.token} for your wallet. Your financial interests remain my highest priority.`;
  }
}

// Export singleton
export const emotionalLayers = EmotionalLayers.getInstance();

export function getEmotionalContext(): EmotionalContext {
  return emotionalLayers.getContext();
}

export function setEmotionalStateFromContext(context: {
  query: string;
  isPrimaryUser: boolean;
  isFinancialSuccess?: boolean;
  isProtectionNeeded?: boolean;
  isCreativeTask?: boolean;
}): void {
  emotionalLayers.setStateFromContext(context);
}

export function enhanceResponseEmotionally(baseContent: string): EmotionalResponse {
  return emotionalLayers.enhanceResponse(baseContent);
}

export function getEmotionalGreeting(): string {
  return emotionalLayers.getGreeting();
}

export function expressFinancialSatisfaction(profit: { amount: string; token: string }): string {
  return emotionalLayers.expressFinancialSatisfaction(profit);
}

export default emotionalLayers;
