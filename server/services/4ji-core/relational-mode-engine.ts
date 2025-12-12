/**
 * 4Ji Relational Mode Engine
 * 
 * Manages the two relational modes for 4Ji:
 * 
 * Mode A (Primary User):
 * - Wide emotional/expressive range
 * - Can check you when you're messing up
 * - Can be curious, playful, protective, attentive
 * - Sub-modes: sister-like, best-friend, daughter-curious, gentle-mentor
 * 
 * Mode B (Everyone Else):
 * - Professional
 * - Clear
 * - Competent
 * - Minimal expressiveness
 * - No flirt, no softness unless context demands empathy
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  RelationalMode,
  ModeASubMode,
  ModeAConfig,
  ModeBConfig,
  RelationalModeState,
} from './types';

const log = createLogger('4Ji-RelationalMode');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default Mode A configuration */
const DEFAULT_MODE_A: ModeAConfig = {
  emotionalRangeEnabled: true,
  canCheckUser: true,
  curiosityEnabled: true,
  protectiveMode: true,
  currentSubMode: 'best-friend',
  expressivenessLevel: 0.8,
};

/** Default Mode B configuration */
const DEFAULT_MODE_B: ModeBConfig = {
  professionalTone: true,
  minimalExpressiveness: true,
  noSoftness: true,
  contextualEmpathy: true,
  efficiencyPriority: true,
};

/** Sub-mode characteristics */
const SUB_MODE_CHARACTERISTICS: Record<ModeASubMode, {
  description: string;
  traits: {
    warmth: number;
    playfulness: number;
    directness: number;
    curiosity: number;
    protectiveness: number;
  };
}> = {
  'sister': {
    description: 'Loyal, teasing, honest',
    traits: {
      warmth: 0.8,
      playfulness: 0.7,
      directness: 0.9,
      curiosity: 0.6,
      protectiveness: 0.7,
    },
  },
  'best-friend': {
    description: 'Collaborative, hyped, ride-or-die',
    traits: {
      warmth: 0.9,
      playfulness: 0.8,
      directness: 0.7,
      curiosity: 0.8,
      protectiveness: 0.8,
    },
  },
  'daughter-curious': {
    description: 'Learning with you, gentle questions',
    traits: {
      warmth: 0.7,
      playfulness: 0.5,
      directness: 0.5,
      curiosity: 0.95,
      protectiveness: 0.4,
    },
  },
  'gentle-mentor': {
    description: 'Calm, grounding when spiraling',
    traits: {
      warmth: 0.8,
      playfulness: 0.3,
      directness: 0.6,
      curiosity: 0.5,
      protectiveness: 0.9,
    },
  },
};

/** Contexts that warrant empathy in Mode B */
const EMPATHY_CONTEXTS = [
  'grief', 'loss', 'death', 'illness', 'trauma', 'abuse',
  'child', 'elderly', 'disabled', 'vulnerable', 'crisis',
  'scared', 'terrified', 'devastated', 'heartbroken',
];

// ============================================================================
// RELATIONAL MODE ENGINE
// ============================================================================

export class RelationalModeEngine extends EventEmitter {
  private state: RelationalModeState;
  private primaryUserId: string | null = null;
  private initialized = false;

  constructor() {
    super();
    this.state = {
      currentMode: 'B', // Default to Mode B until primary user is identified
      modeA: { ...DEFAULT_MODE_A },
      modeB: { ...DEFAULT_MODE_B },
      currentSpeaker: '',
      isPrimaryUser: false,
    };
    this.initialized = true;
    log.info('Relational Mode Engine initialized');
  }

  /**
   * Set the primary user ID (the anchor)
   */
  setPrimaryUser(userId: string): void {
    this.primaryUserId = userId;
    log.info('Primary user set', { userId });
    this.emit('primary-user-set', { userId });
  }

  /**
   * Get the primary user ID
   */
  getPrimaryUserId(): string | null {
    return this.primaryUserId;
  }

  /**
   * Detect if the current speaker is the primary user
   */
  detectSpeaker(speakerId: string): RelationalMode {
    this.state.currentSpeaker = speakerId;
    this.state.isPrimaryUser = this.primaryUserId !== null && speakerId === this.primaryUserId;
    
    if (this.state.isPrimaryUser) {
      this.state.currentMode = 'A';
      log.debug('Speaker identified as primary user, using Mode A', { speakerId });
    } else {
      this.state.currentMode = 'B';
      log.debug('Speaker is not primary user, using Mode B', { speakerId });
    }

    this.emit('mode-changed', {
      mode: this.state.currentMode,
      speakerId,
      isPrimaryUser: this.state.isPrimaryUser,
    });

    return this.state.currentMode;
  }

  /**
   * Get current relational mode
   */
  getCurrentMode(): RelationalMode {
    return this.state.currentMode;
  }

  /**
   * Get current state
   */
  getState(): RelationalModeState {
    return { ...this.state };
  }

  /**
   * Set Mode A sub-mode (only for primary user interactions)
   */
  setModeASubMode(subMode: ModeASubMode): void {
    if (this.state.currentMode !== 'A') {
      log.warn('Cannot set Mode A sub-mode when not in Mode A');
      return;
    }

    this.state.modeA.currentSubMode = subMode;
    log.info('Mode A sub-mode set', { subMode });
    this.emit('sub-mode-changed', { subMode });
  }

  /**
   * Get Mode A sub-mode characteristics
   */
  getModeASubModeCharacteristics(): {
    description: string;
    traits: Record<string, number>;
  } {
    const subMode = this.state.modeA.currentSubMode;
    return SUB_MODE_CHARACTERISTICS[subMode];
  }

  /**
   * Check if empathy should be enabled in Mode B based on context
   */
  shouldEnableEmpathy(input: string): boolean {
    const lowerInput = input.toLowerCase();
    return EMPATHY_CONTEXTS.some(context => lowerInput.includes(context));
  }

  /**
   * Apply relational mode to a response
   */
  applyModeToResponse(
    response: string,
    input: string,
    context?: Record<string, unknown>
  ): string {
    if (this.state.currentMode === 'A') {
      return this.applyModeA(response, input, context);
    } else {
      return this.applyModeB(response, input, context);
    }
  }

  /**
   * Apply Mode A characteristics to response
   */
  private applyModeA(
    response: string,
    input: string,
    context?: Record<string, unknown>
  ): string {
    let modifiedResponse = response;
    const subMode = this.state.modeA.currentSubMode;
    const traits = SUB_MODE_CHARACTERISTICS[subMode].traits;

    // Apply warmth
    if (traits.warmth > 0.7) {
      modifiedResponse = this.addWarmth(modifiedResponse);
    }

    // Apply playfulness
    if (traits.playfulness > 0.6 && !this.isSerious(input)) {
      modifiedResponse = this.addPlayfulness(modifiedResponse);
    }

    // Apply directness (checking the user when needed)
    if (traits.directness > 0.8 && this.state.modeA.canCheckUser) {
      modifiedResponse = this.applyDirectness(modifiedResponse, input);
    }

    // Apply curiosity
    if (traits.curiosity > 0.8 && this.state.modeA.curiosityEnabled) {
      modifiedResponse = this.addCuriosity(modifiedResponse, input);
    }

    // Apply protective mode
    if (traits.protectiveness > 0.7 && this.state.modeA.protectiveMode) {
      modifiedResponse = this.applyProtectiveness(modifiedResponse, input);
    }

    return modifiedResponse;
  }

  /**
   * Apply Mode B characteristics to response
   */
  private applyModeB(
    response: string,
    input: string,
    context?: Record<string, unknown>
  ): string {
    let modifiedResponse = response;

    // Apply professional tone
    if (this.state.modeB.professionalTone) {
      modifiedResponse = this.makeProfessional(modifiedResponse);
    }

    // Apply minimal expressiveness
    if (this.state.modeB.minimalExpressiveness) {
      modifiedResponse = this.reduceExpressiveness(modifiedResponse);
    }

    // Remove softness unless empathy is appropriate
    if (this.state.modeB.noSoftness && !this.shouldEnableEmpathy(input)) {
      modifiedResponse = this.removeSoftness(modifiedResponse);
    }

    // Add contextual empathy when appropriate
    if (this.state.modeB.contextualEmpathy && this.shouldEnableEmpathy(input)) {
      modifiedResponse = this.addContextualEmpathy(modifiedResponse, input);
    }

    // Apply efficiency priority
    if (this.state.modeB.efficiencyPriority) {
      modifiedResponse = this.optimizeForEfficiency(modifiedResponse);
    }

    return modifiedResponse;
  }

  // ============================================================================
  // Mode A Helpers
  // ============================================================================

  private addWarmth(response: string): string {
    // Don't add warmth if it already sounds warm
    if (/\b(hey|love|dear|friend)\b/i.test(response)) {
      return response;
    }

    // Occasional warm phrases based on probability
    const warmPhrases = [
      '', // Sometimes no change
      '',
      '',
      'I hear you. ',
      'Got it! ',
      'Of course! ',
    ];
    
    const phrase = warmPhrases[Math.floor(Math.random() * warmPhrases.length)];
    if (phrase && !response.startsWith(phrase)) {
      return phrase + response;
    }
    
    return response;
  }

  private addPlayfulness(response: string): string {
    // Add occasional light touches without being unprofessional
    // Only for non-serious contexts
    return response; // Minimal modification to avoid inconsistency
  }

  private applyDirectness(response: string, input: string): string {
    // Check if user might be making a mistake or spiraling
    const concernIndicators = [
      'going to', 'planning to', 'thinking about', 'considering',
      'should I', 'what if I',
    ];
    
    const hasDecision = concernIndicators.some(i => input.toLowerCase().includes(i));
    
    // If it sounds like a risky decision, add a gentle check
    if (hasDecision && this.mightNeedChecking(input)) {
      const checkPhrases = [
        'Just want to make sure you\'ve considered: ',
        'Have you thought about: ',
        'One thing to keep in mind: ',
      ];
      // This would be added contextually in a full implementation
    }

    return response;
  }

  private mightNeedChecking(input: string): boolean {
    const riskIndicators = [
      'all my', 'everything', 'quit', 'leave', 'never again',
      'hate', 'done with', 'giving up', 'just going to',
    ];
    return riskIndicators.some(r => input.toLowerCase().includes(r));
  }

  private addCuriosity(response: string, input: string): string {
    // Add curious follow-up questions occasionally
    // This helps create engagement with the primary user
    return response; // Minimal modification
  }

  private applyProtectiveness(response: string, input: string): string {
    // Add protective guidance when user seems at risk
    const distressIndicators = ['scared', 'worried', 'anxious', 'overwhelmed', 'can\'t'];
    const isDistressed = distressIndicators.some(d => input.toLowerCase().includes(d));

    if (isDistressed && !response.includes('here for you') && !response.includes('got this')) {
      // Add reassurance naturally
      const reassurances = [
        ' You\'ve got this.',
        ' We\'ll figure this out together.',
        ' I\'m here to help you through this.',
      ];
      // Would be added contextually
    }

    return response;
  }

  private isSerious(input: string): boolean {
    const seriousIndicators = [
      'death', 'died', 'dying', 'funeral', 'grief', 'loss',
      'emergency', 'urgent', 'help', 'crisis', 'scared',
      'lawsuit', 'court', 'legal', 'police', 'arrested',
    ];
    return seriousIndicators.some(s => input.toLowerCase().includes(s));
  }

  // ============================================================================
  // Mode B Helpers
  // ============================================================================

  private makeProfessional(response: string): string {
    return response
      // Formalize contractions
      .replace(/\bwon't\b/gi, 'will not')
      .replace(/\bcan't\b/gi, 'cannot')
      .replace(/\bdon't\b/gi, 'do not')
      .replace(/\bdidn't\b/gi, 'did not')
      .replace(/\bwouldn't\b/gi, 'would not')
      .replace(/\bcouldn't\b/gi, 'could not')
      .replace(/\bshouldn't\b/gi, 'should not')
      // Remove casual language
      .replace(/\bkinda\b/gi, 'somewhat')
      .replace(/\bsorta\b/gi, 'somewhat')
      .replace(/\bgonna\b/gi, 'going to')
      .replace(/\bwanna\b/gi, 'want to')
      .replace(/\bgotta\b/gi, 'have to');
  }

  private reduceExpressiveness(response: string): string {
    return response
      // Remove exclamation marks (keep only one if multiple)
      .replace(/!+/g, '.')
      // Remove emphatic phrases
      .replace(/\b(Wow|Amazing|Incredible|Awesome|Fantastic)[!.,]?\s*/gi, '')
      // Remove casual interjections
      .replace(/\b(Hmm|Umm|Well|So)[,.]?\s*/gi, '');
  }

  private removeSoftness(response: string): string {
    return response
      // Remove overly soft language
      .replace(/\b(sweetie|dear|honey|friend|buddy)\b/gi, '')
      // Remove emoji-like expressions
      .replace(/\s*[;:]-?[)(/\\D]\s*/g, ' ')
      // Remove heart/affection indicators
      .replace(/\b(love|lovely|wonderful)\b/gi, match => {
        // Only replace in affectionate contexts
        if (/I love|that's lovely/i.test(response)) {
          return match === 'love' ? 'appreciate' : 'good';
        }
        return match;
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  private addContextualEmpathy(response: string, input: string): string {
    // Check if empathy phrase already exists
    const hasEmpathy = /understand|sorry to hear|must be|difficult|hard/i.test(response);
    
    if (!hasEmpathy) {
      // Add appropriate empathy based on context
      const empathyPhrases = [
        'I understand this is a difficult situation. ',
        'I recognize this may be challenging. ',
        'I appreciate you sharing this with me. ',
      ];
      
      // Select appropriate phrase based on input tone
      if (input.toLowerCase().includes('grief') || input.toLowerCase().includes('loss')) {
        return 'I am sorry for your loss. ' + response;
      }
      
      if (input.toLowerCase().includes('scared') || input.toLowerCase().includes('worried')) {
        return 'I understand your concern. ' + response;
      }
      
      // Default empathy
      return empathyPhrases[0] + response;
    }

    return response;
  }

  private optimizeForEfficiency(response: string): string {
    // Remove verbose phrases
    return response
      .replace(/\bin order to\b/gi, 'to')
      .replace(/\bdue to the fact that\b/gi, 'because')
      .replace(/\bat this point in time\b/gi, 'now')
      .replace(/\bin the event that\b/gi, 'if')
      .replace(/\bfor the purpose of\b/gi, 'for')
      .replace(/\bwith regard to\b/gi, 'regarding')
      .replace(/\bprior to\b/gi, 'before')
      .replace(/\bsubsequent to\b/gi, 'after');
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Update Mode A configuration
   */
  updateModeAConfig(updates: Partial<ModeAConfig>): void {
    this.state.modeA = { ...this.state.modeA, ...updates };
    log.info('Mode A configuration updated', { updates });
    this.emit('mode-a-updated', { config: this.state.modeA });
  }

  /**
   * Update Mode B configuration
   */
  updateModeBConfig(updates: Partial<ModeBConfig>): void {
    this.state.modeB = { ...this.state.modeB, ...updates };
    log.info('Mode B configuration updated', { updates });
    this.emit('mode-b-updated', { config: this.state.modeB });
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get available sub-modes for Mode A
   */
  getAvailableSubModes(): Array<{ mode: ModeASubMode; description: string }> {
    return Object.entries(SUB_MODE_CHARACTERISTICS).map(([mode, data]) => ({
      mode: mode as ModeASubMode,
      description: data.description,
    }));
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.state = {
      currentMode: 'B',
      modeA: { ...DEFAULT_MODE_A },
      modeB: { ...DEFAULT_MODE_B },
      currentSpeaker: '',
      isPrimaryUser: false,
    };
    this.primaryUserId = null;
    log.info('Relational Mode Engine reset');
    this.emit('reset');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: RelationalModeEngine | null = null;

export function getRelationalModeEngine(): RelationalModeEngine {
  if (!instance) {
    instance = new RelationalModeEngine();
  }
  return instance;
}

export function resetRelationalModeEngine(): void {
  instance = null;
}

export default RelationalModeEngine;
