/**
 * LEXARA State Management Module
 * 
 * Maintains session-level memory for Lexara's tone, mode, and intent.
 * Provides utilities for mode transitions and context-aware suggestions.
 */

// ============================================================================
// TYPES
// ============================================================================

export type LexaraMode = 
  | 'default'
  | 'analysis'
  | 'satelliteMode'
  | 'peopleRadarMode'
  | 'inmateMode'
  | 'docGenMode';

export type LexaraTone = 
  | 'soft'
  | 'steady'
  | 'excited'
  | 'serious';

export type LexaraIntent = 
  | 'greeting'
  | 'consultation'
  | 'research'
  | 'documentation'
  | 'analysis'
  | 'location'
  | 'idle';

export type LexaraEmotionState = 
  | 'curious'
  | 'focused'
  | 'alert'
  | 'empathetic';

export interface LexaraSessionState {
  mode: LexaraMode;
  tone: LexaraTone;
  intent: LexaraIntent;
  emotion: LexaraEmotionState;
  modeHistory: Array<{ mode: LexaraMode; timestamp: number }>;
  conversationContext: string[];
  lastInteraction: number;
  systemOverride: boolean;
}

export interface ModeTransitionResult {
  success: boolean;
  previousMode: LexaraMode;
  newMode: LexaraMode;
  reason?: string;
}

export interface ModeOffer {
  suggestedMode: LexaraMode;
  reason: string;
  confidence: number;
  contextKeywords: string[];
}

// ============================================================================
// CONTEXT DETECTION PATTERNS
// ============================================================================

const MODE_CONTEXT_PATTERNS: Record<LexaraMode, string[]> = {
  default: [],
  analysis: [
    'analyze', 'analysis', 'evaluate', 'assess', 'review', 'examine',
    'investigate', 'inspect', 'study', 'research', 'evidence', 'document'
  ],
  satelliteMode: [
    'satellite', 'map', 'location', 'gps', 'coordinates', 'address',
    'where', 'place', 'position', 'track', 'locate', 'find location',
    'show map', 'satellite view', 'aerial'
  ],
  peopleRadarMode: [
    'people', 'person', 'find person', 'locate person', 'search person',
    'radar', 'nearby', 'who', 'identity', 'identify', 'face', 'people finder',
    'background check'
  ],
  inmateMode: [
    'inmate', 'prisoner', 'jail', 'prison', 'incarcerated', 'detention',
    'custody', 'facility', 'correctional', 'locked up', 'booking'
  ],
  docGenMode: [
    'document', 'generate', 'create', 'write', 'draft', 'petition',
    'complaint', 'letter', 'form', 'legal document', 'foia', 'lawsuit'
  ],
};

// ============================================================================
// LEXARA STATE CLASS
// ============================================================================

export class LexaraStateManager {
  private state: LexaraSessionState;
  private listeners: Set<(state: LexaraSessionState) => void>;

  constructor() {
    this.state = this.getInitialState();
    this.listeners = new Set();
  }

  private getInitialState(): LexaraSessionState {
    return {
      mode: 'default',
      tone: 'soft',
      intent: 'greeting',
      emotion: 'curious',
      modeHistory: [],
      conversationContext: [],
      lastInteraction: Date.now(),
      systemOverride: false,
    };
  }

  // ============================================================================
  // STATE ACCESS
  // ============================================================================

  getState(): Readonly<LexaraSessionState> {
    return { ...this.state };
  }

  getMode(): LexaraMode {
    return this.state.mode;
  }

  getTone(): LexaraTone {
    return this.state.tone;
  }

  getIntent(): LexaraIntent {
    return this.state.intent;
  }

  getEmotion(): LexaraEmotionState {
    return this.state.emotion;
  }

  // ============================================================================
  // MODE TRANSITIONS
  // ============================================================================

  /**
   * Transition to the next mode programmatically
   * Used for explicit mode switches
   */
  nextMode(targetMode: LexaraMode, reason?: string): ModeTransitionResult {
    const previousMode = this.state.mode;
    
    // Check if system override is blocking transitions
    if (this.state.systemOverride && targetMode !== this.state.mode) {
      return {
        success: false,
        previousMode,
        newMode: previousMode,
        reason: 'System override is active - mode transitions blocked',
      };
    }

    // Record mode history
    this.state.modeHistory.push({
      mode: previousMode,
      timestamp: Date.now(),
    });

    // Keep history limited to last 20 entries
    if (this.state.modeHistory.length > 20) {
      this.state.modeHistory = this.state.modeHistory.slice(-20);
    }

    // Update mode
    this.state.mode = targetMode;
    this.state.lastInteraction = Date.now();

    // Update emotion based on mode
    this.updateEmotionForMode(targetMode);

    // Notify listeners
    this.notifyListeners();

    return {
      success: true,
      previousMode,
      newMode: targetMode,
      reason,
    };
  }

  /**
   * Offer a mode transition when LEXARA detects relevant context
   * Returns a suggestion without automatically switching
   */
  offerMode(userInput: string): ModeOffer | null {
    const lowercaseInput = userInput.toLowerCase();
    
    // Find the best matching mode based on context
    let bestMatch: { mode: LexaraMode; score: number; keywords: string[] } | null = null;

    for (const [mode, patterns] of Object.entries(MODE_CONTEXT_PATTERNS)) {
      if (mode === 'default') continue;
      
      const matchedKeywords = patterns.filter(pattern => 
        lowercaseInput.includes(pattern.toLowerCase())
      );
      
      if (matchedKeywords.length > 0) {
        const score = matchedKeywords.length / patterns.length;
        
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            mode: mode as LexaraMode,
            score,
            keywords: matchedKeywords,
          };
        }
      }
    }

    if (!bestMatch || bestMatch.score < 0.05) {
      return null;
    }

    // Don't offer the current mode
    if (bestMatch.mode === this.state.mode) {
      return null;
    }

    // Generate reason based on matched keywords
    const reason = this.generateModeOfferReason(bestMatch.mode, bestMatch.keywords);

    return {
      suggestedMode: bestMatch.mode,
      reason,
      confidence: Math.min(bestMatch.score * 2, 1),
      contextKeywords: bestMatch.keywords,
    };
  }

  private generateModeOfferReason(mode: LexaraMode, keywords: string[]): string {
    const keywordList = keywords.slice(0, 3).join(', ');
    
    switch (mode) {
      case 'analysis':
        return `I noticed you mentioned "${keywordList}". Would you like me to switch to analysis mode for deeper examination?`;
      case 'satelliteMode':
        return `You mentioned location-related terms like "${keywordList}". Should I show you the satellite view?`;
      case 'peopleRadarMode':
        return `I see you're looking for information about people (${keywordList}). Would you like to activate People Radar?`;
      case 'inmateMode':
        return `You mentioned "${keywordList}". Want me to switch to Inmate Locator mode?`;
      case 'docGenMode':
        return `It sounds like you need a document (${keywordList}). Should I help you create one?`;
      default:
        return `Based on your input, I suggest switching to ${mode} mode.`;
    }
  }

  // ============================================================================
  // STATE UPDATES
  // ============================================================================

  setTone(tone: LexaraTone): void {
    this.state.tone = tone;
    this.state.lastInteraction = Date.now();
    this.notifyListeners();
  }

  setIntent(intent: LexaraIntent): void {
    this.state.intent = intent;
    this.state.lastInteraction = Date.now();
    this.notifyListeners();
  }

  setEmotion(emotion: LexaraEmotionState): void {
    this.state.emotion = emotion;
    this.state.lastInteraction = Date.now();
    this.notifyListeners();
  }

  addConversationContext(context: string): void {
    this.state.conversationContext.push(context);
    
    // Keep context limited to last 50 entries
    if (this.state.conversationContext.length > 50) {
      this.state.conversationContext = this.state.conversationContext.slice(-50);
    }
    
    this.state.lastInteraction = Date.now();
  }

  private updateEmotionForMode(mode: LexaraMode): void {
    switch (mode) {
      case 'analysis':
        this.state.emotion = 'focused';
        break;
      case 'satelliteMode':
      case 'peopleRadarMode':
        this.state.emotion = 'alert';
        break;
      case 'inmateMode':
        this.state.emotion = 'empathetic';
        break;
      case 'docGenMode':
        this.state.emotion = 'focused';
        break;
      default:
        this.state.emotion = 'curious';
    }
  }

  // ============================================================================
  // SYSTEM OVERRIDE
  // ============================================================================

  /**
   * Enable system-level override for precision tasks
   * Prevents automatic mode transitions
   */
  enableSystemOverride(): void {
    this.state.systemOverride = true;
    this.notifyListeners();
  }

  /**
   * Disable system-level override
   */
  disableSystemOverride(): void {
    this.state.systemOverride = false;
    this.notifyListeners();
  }

  isSystemOverrideActive(): boolean {
    return this.state.systemOverride;
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  /**
   * Reset state to initial values
   */
  resetSession(): void {
    this.state = this.getInitialState();
    this.notifyListeners();
  }

  /**
   * Get time since last interaction in milliseconds
   */
  getIdleTime(): number {
    return Date.now() - this.state.lastInteraction;
  }

  /**
   * Check if session is idle (no interaction for 5 minutes)
   */
  isIdle(): boolean {
    return this.getIdleTime() > 5 * 60 * 1000;
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

  subscribe(listener: (state: LexaraSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const stateCopy = this.getState();
    this.listeners.forEach(listener => listener(stateCopy));
  }
}

// ============================================================================
// SINGLETON INSTANCE - Module-level lazy initialization
// JavaScript's module system ensures this is only created once on first access
// ============================================================================

// Create the singleton at module load time for guaranteed single instance
const stateManagerInstance = new LexaraStateManager();

export function getLexaraStateManager(): LexaraStateManager {
  return stateManagerInstance;
}

// ============================================================================
// REACT HOOK UTILITIES
// ============================================================================

/**
 * Get initial state for React useState
 */
export function getInitialLexaraState(): LexaraSessionState {
  return getLexaraStateManager().getState();
}
