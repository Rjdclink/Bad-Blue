/**
 * 4Ji Personality Blender
 * 
 * After models respond, run all candidate texts through:
 * 1. Paradox Core (25 layers)
 * 2. Cognitive Fabric (reasoning + consistency check)
 * 3. Relational Mode Logic (you vs others)
 * 4. Personality Style Layer (4Ji's voice profile)
 * 
 * The final result:
 * - Always sounds like 4Ji
 * - Never "I am DeepSeek / GPT / Gemini" — those names don't appear
 * - No split identities
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  VoiceProfile,
  BlendedPersonalityResult,
  RawModelResponse,
  RelationalMode,
} from './types';
import { getParadoxCore } from './paradox-core';
import { getCognitiveFabric } from './cognitive-fabric';
import { getRelationalModeEngine } from './relational-mode-engine';

const log = createLogger('4Ji-PersonalityBlender');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default 4Ji voice profile */
const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  traits: {
    curiosity: 0.8,
    warmth: 0.7,
    directness: 0.75,
    playfulness: 0.6,
    protectiveness: 0.7,
    professionalism: 0.8,
  },
  linguisticStyle: {
    formalityLevel: 0.5,
    verbosity: 0.4,
    emotionalExpression: 0.6,
  },
  constraints: {
    neverMentionOtherAIs: true,
    alwaysUnifiedVoice: true,
    noSplitPersonality: true,
  },
};

/** AI names that must be scrubbed from output */
const FORBIDDEN_AI_NAMES = [
  'ChatGPT', 'GPT-4', 'GPT-3', 'GPT-4o', 'GPT-4-turbo',
  'Claude', 'Claude 2', 'Claude 3',
  'Gemini', 'Bard', 'Google AI',
  'DeepSeek', 'Mistral', 'LLaMA', 'Llama',
  'Copilot', 'Bing AI',
  'OpenAI', 'Anthropic', 'Google',
  'PaLM', 'Command', 'Cohere',
  'Falcon', 'MPT', 'Dolly',
  'as an AI', 'as a language model', 'as an assistant',
  'I am an AI', 'I\'m an AI', 'I am a large language model',
];

/** Phrases that indicate split personality (must be avoided) */
const SPLIT_PERSONALITY_PATTERNS = [
  /I have (multiple|different) personalities/i,
  /one part of me.*another part/i,
  /my (other|different) self/i,
  /when I'm in.*mode/i,
  /switching between/i,
];

// ============================================================================
// PERSONALITY BLENDER
// ============================================================================

export class PersonalityBlender extends EventEmitter {
  private voiceProfile: VoiceProfile;
  private initialized = false;

  constructor(customProfile?: Partial<VoiceProfile>) {
    super();
    this.voiceProfile = {
      ...DEFAULT_VOICE_PROFILE,
      ...customProfile,
      traits: {
        ...DEFAULT_VOICE_PROFILE.traits,
        ...customProfile?.traits,
      },
      linguisticStyle: {
        ...DEFAULT_VOICE_PROFILE.linguisticStyle,
        ...customProfile?.linguisticStyle,
      },
      constraints: {
        ...DEFAULT_VOICE_PROFILE.constraints,
        ...customProfile?.constraints,
      },
    };
    this.initialized = true;
    log.info('Personality Blender initialized');
  }

  /**
   * Blend multiple model responses into a single 4Ji voice
   */
  async blend(
    rawResponses: RawModelResponse[],
    context: {
      userInput: string;
      speakerId: string;
      isPrimaryUser: boolean;
    }
  ): Promise<BlendedPersonalityResult> {
    const startTime = Date.now();
    
    if (rawResponses.length === 0) {
      throw new Error('No responses to blend');
    }

    // Step 1: Select best raw response or combine them
    const combinedRaw = this.combineRawResponses(rawResponses);

    // Step 2: Process through Paradox Core (25 layers)
    const paradoxCore = getParadoxCore();
    const paradoxResult = await paradoxCore.process(combinedRaw, { input: context.userInput });
    const afterParadoxCore = paradoxResult.unifiedViewpoint || combinedRaw;

    // Step 3: Process through Cognitive Fabric
    const cognitiveFabric = getCognitiveFabric();
    const cognitiveResult = await cognitiveFabric.process(afterParadoxCore, {
      relationalMode: context.isPrimaryUser ? 'A' : 'B',
      isPrimaryUser: context.isPrimaryUser,
    });
    const afterCognitiveFabric = cognitiveResult.finalOutput;

    // Step 4: Apply Relational Mode
    const relationalEngine = getRelationalModeEngine();
    relationalEngine.detectSpeaker(context.speakerId);
    const afterRelationalMode = relationalEngine.applyModeToResponse(
      afterCognitiveFabric,
      context.userInput
    );

    // Step 5: Apply 4Ji Voice Profile (Personality Style Layer)
    const final4JiResponse = this.applyVoiceProfile(afterRelationalMode, context);

    // Step 6: Final verification and cleanup
    const verified4JiResponse = this.verifyAndCleanup(final4JiResponse);

    const result: BlendedPersonalityResult = {
      rawResponses,
      afterParadoxCore,
      afterCognitiveFabric,
      afterRelationalMode,
      final4JiResponse: verified4JiResponse,
      voiceProfileUsed: this.voiceProfile,
    };

    this.emit('blend-complete', {
      rawResponseCount: rawResponses.length,
      processingTime: Date.now() - startTime,
    });

    return result;
  }

  /**
   * Combine multiple raw responses intelligently
   */
  private combineRawResponses(responses: RawModelResponse[]): string {
    if (responses.length === 1) {
      return responses[0].content;
    }

    // Sort by confidence and take the best one as primary
    const sorted = [...responses].sort((a, b) => b.confidence - a.confidence);
    const primary = sorted[0];

    // If other responses have high confidence, consider integrating their unique insights
    const secondary = sorted.slice(1).filter(r => r.confidence >= 0.7);

    if (secondary.length === 0) {
      return primary.content;
    }

    // For now, use the primary response
    // A more sophisticated implementation would merge unique insights
    return primary.content;
  }

  /**
   * Apply 4Ji voice profile to response
   */
  private applyVoiceProfile(
    response: string,
    context: { isPrimaryUser: boolean }
  ): string {
    let styled = response;

    // Apply formality based on profile
    if (this.voiceProfile.linguisticStyle.formalityLevel < 0.3) {
      styled = this.makeCasual(styled);
    } else if (this.voiceProfile.linguisticStyle.formalityLevel > 0.7) {
      styled = this.makeFormal(styled);
    }

    // Apply verbosity preferences
    if (this.voiceProfile.linguisticStyle.verbosity < 0.3) {
      styled = this.makeConcise(styled);
    }

    // Apply emotional expression based on context
    if (context.isPrimaryUser && this.voiceProfile.linguisticStyle.emotionalExpression > 0.5) {
      // Allow more emotional expression for primary user
      // (Don't remove emotional language)
    } else if (!context.isPrimaryUser && this.voiceProfile.linguisticStyle.emotionalExpression > 0.5) {
      // Reduce emotional expression for others
      styled = this.reduceEmotionalExpression(styled);
    }

    // Apply warmth (for primary user)
    if (context.isPrimaryUser && this.voiceProfile.traits.warmth > 0.6) {
      styled = this.ensureWarmth(styled);
    }

    // Apply directness
    if (this.voiceProfile.traits.directness > 0.7) {
      styled = this.ensureDirectness(styled);
    }

    return styled;
  }

  /**
   * Make response more casual
   */
  private makeCasual(response: string): string {
    return response
      .replace(/\bwill not\b/gi, "won't")
      .replace(/\bcannot\b/gi, "can't")
      .replace(/\bdo not\b/gi, "don't")
      .replace(/\bI am\b/gi, "I'm")
      .replace(/\byou are\b/gi, "you're")
      .replace(/\bthey are\b/gi, "they're");
  }

  /**
   * Make response more formal
   */
  private makeFormal(response: string): string {
    return response
      .replace(/\bwon't\b/gi, 'will not')
      .replace(/\bcan't\b/gi, 'cannot')
      .replace(/\bdon't\b/gi, 'do not')
      .replace(/\bI'm\b/gi, 'I am')
      .replace(/\byou're\b/gi, 'you are')
      .replace(/\bthey're\b/gi, 'they are')
      .replace(/\bgonna\b/gi, 'going to')
      .replace(/\bwanna\b/gi, 'want to');
  }

  /**
   * Make response more concise
   */
  private makeConcise(response: string): string {
    return response
      .replace(/\bin order to\b/gi, 'to')
      .replace(/\bdue to the fact that\b/gi, 'because')
      .replace(/\bat this point in time\b/gi, 'now')
      .replace(/\bin the event that\b/gi, 'if')
      .replace(/\bfor the purpose of\b/gi, 'for')
      .replace(/\bwith regard to\b/gi, 'regarding')
      .replace(/\bthe majority of\b/gi, 'most');
  }

  /**
   * Reduce emotional expression
   */
  private reduceEmotionalExpression(response: string): string {
    return response
      .replace(/!+/g, '.')
      .replace(/\b(Wow|Amazing|Incredible|Awesome|Fantastic)[!.,]?\s*/gi, '')
      .replace(/\b(I feel|I'm feeling)\b/gi, 'I think')
      .replace(/\b(excited|thrilled|delighted)\b/gi, 'pleased');
  }

  /**
   * Ensure response has appropriate warmth
   */
  private ensureWarmth(response: string): string {
    // Check if response already has warmth indicators
    const warmthIndicators = /\b(understand|appreciate|hear you|here for|support)\b/i;
    if (warmthIndicators.test(response)) {
      return response;
    }

    // For short responses without warmth, this is fine
    if (response.length < 50) {
      return response;
    }

    return response;
  }

  /**
   * Ensure response is direct
   */
  private ensureDirectness(response: string): string {
    return response
      .replace(/\bI think maybe\b/gi, 'I think')
      .replace(/\bIt seems like perhaps\b/gi, 'It seems')
      .replace(/\bPossibly you could\b/gi, 'You could')
      .replace(/\bIt might be worth considering\b/gi, 'Consider');
  }

  /**
   * Verify response meets 4Ji constraints and clean up
   */
  private verifyAndCleanup(response: string): string {
    let cleaned = response;

    // Remove any mentions of other AI names
    for (const name of FORBIDDEN_AI_NAMES) {
      const regex = new RegExp(name, 'gi');
      cleaned = cleaned.replace(regex, '4Ji');
    }

    // Remove any pattern that suggests split personality
    for (const pattern of SPLIT_PERSONALITY_PATTERNS) {
      if (pattern.test(cleaned)) {
        // Remove the problematic sentence
        cleaned = cleaned.replace(pattern, '');
      }
    }

    // Ensure no "I am an AI" type phrases
    cleaned = cleaned
      .replace(/I am (an? )?(AI|artificial intelligence|language model|assistant|chatbot)/gi, 'I am 4Ji')
      .replace(/I'm (an? )?(AI|artificial intelligence|language model|assistant|chatbot)/gi, "I'm 4Ji")
      .replace(/As (an? )?(AI|artificial intelligence|language model|assistant|chatbot)/gi, 'As 4Ji');

    // Clean up whitespace
    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?])/g, '$1')
      .trim();

    // Verify unified voice - no contradictory self-references
    if (cleaned.includes('4Ji') && (cleaned.includes('GPT') || cleaned.includes('Claude'))) {
      // Remove the contradictory reference
      cleaned = cleaned.replace(/\b(GPT|Claude|Gemini)\b/gi, '4Ji');
    }

    return cleaned;
  }

  /**
   * Update voice profile
   */
  updateVoiceProfile(updates: Partial<VoiceProfile>): void {
    if (updates.traits) {
      this.voiceProfile.traits = {
        ...this.voiceProfile.traits,
        ...updates.traits,
      };
    }
    if (updates.linguisticStyle) {
      this.voiceProfile.linguisticStyle = {
        ...this.voiceProfile.linguisticStyle,
        ...updates.linguisticStyle,
      };
    }
    if (updates.constraints) {
      this.voiceProfile.constraints = {
        ...this.voiceProfile.constraints,
        ...updates.constraints,
      };
    }
    log.info('Voice profile updated');
    this.emit('voice-profile-updated', { profile: this.voiceProfile });
  }

  /**
   * Get current voice profile
   */
  getVoiceProfile(): VoiceProfile {
    return { ...this.voiceProfile };
  }

  /**
   * Quick transform - apply 4Ji voice without full blend pipeline
   */
  quickTransform(
    text: string,
    options?: { isPrimaryUser?: boolean }
  ): string {
    let transformed = text;

    // Apply basic voice constraints
    for (const name of FORBIDDEN_AI_NAMES) {
      const regex = new RegExp(name, 'gi');
      transformed = transformed.replace(regex, '4Ji');
    }

    // Apply basic style
    if (options?.isPrimaryUser) {
      transformed = this.ensureWarmth(transformed);
    } else {
      transformed = this.makeFormal(transformed);
    }

    return this.verifyAndCleanup(transformed);
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: PersonalityBlender | null = null;

export function getPersonalityBlender(
  customProfile?: Partial<VoiceProfile>
): PersonalityBlender {
  if (!instance) {
    instance = new PersonalityBlender(customProfile);
  }
  return instance;
}

export function resetPersonalityBlender(): void {
  instance = null;
}

export default PersonalityBlender;
