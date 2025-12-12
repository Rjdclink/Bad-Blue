/**
 * 4Ji Emotional-Tension System - 3 Layer System
 * 
 * Simulates "taking a breath / thinking / cooling off" — not actual emotion,
 * but realistic pauses and depth.
 * 
 * Layer Structure:
 * - ET1: Detect tension (topic + tone + stakes)
 * - ET2: Increase internal passes, ask clarifying questions if needed
 * - ET3: Output something more grounded and less reactive
 * 
 * These layers create thoughtful, measured responses when dealing with
 * uncertainty, conflict, or emotionally charged topics.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  EmotionalTensionLayer,
  EmotionalTensionConfig,
  TensionDetection,
  EmotionalTensionResult,
} from './types';

const log = createLogger('4Ji-EmotionalTension');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default configuration for emotional tension processing */
const DEFAULT_CONFIG: EmotionalTensionConfig = {
  tensionThreshold: 0.6,
  maxExtraPasses: 3,
  minResponseDelay: 500, // ms
  askClarifyingQuestions: true,
};

/** Keywords that indicate high topic tension */
const HIGH_TENSION_TOPICS = [
  // Emotionally charged
  'death', 'died', 'dying', 'grief', 'loss', 'trauma', 'abuse', 'violence',
  'suicide', 'depression', 'anxiety', 'fear', 'panic',
  // Controversial
  'politics', 'religion', 'abortion', 'gun', 'immigration', 'racism',
  // High stakes
  'emergency', 'urgent', 'critical', 'lawsuit', 'court', 'legal action',
  'arrest', 'police', 'crime', 'victim',
  // Personal crisis
  'divorce', 'breakup', 'fired', 'bankrupt', 'homeless', 'sick', 'cancer',
];

/** Keywords that indicate high-stakes situations */
const HIGH_STAKES_INDICATORS = [
  'must', 'have to', 'need to immediately', 'right now', 'urgent',
  'deadline', 'emergency', 'life or death', 'only chance', 'last resort',
  'can\'t afford', 'losing everything', 'end of', 'desperate',
];

/** Tone indicators for tension detection */
const NEGATIVE_TONE_MARKERS = [
  'angry', 'furious', 'frustrated', 'annoyed', 'upset', 'hurt',
  'scared', 'terrified', 'worried', 'anxious', 'stressed',
  'devastated', 'heartbroken', 'hopeless', 'helpless',
  '!', '!!!', 'WTF', 'OMG', 'I CAN\'T BELIEVE',
];

// ============================================================================
// EMOTIONAL TENSION BUFFER SYSTEM
// ============================================================================

export class EmotionalTensionSystem extends EventEmitter {
  private config: EmotionalTensionConfig;
  private initialized = false;
  private processingActive = false;
  private currentTensionBuffer: TensionDetection | null = null;

  constructor(config?: Partial<EmotionalTensionConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initialized = true;
    log.info('Emotional Tension System initialized', { config: this.config });
  }

  /**
   * Process input through all 3 emotional-tension layers
   */
  async process(
    input: string,
    proposedResponse: string,
    context?: Record<string, unknown>
  ): Promise<EmotionalTensionResult> {
    const startTime = Date.now();
    
    this.processingActive = true;
    this.emit('processing-started', { inputLength: input.length });

    try {
      // Layer ET1: Detect tension
      const detection = await this.runET1Detection(input, context);
      this.currentTensionBuffer = detection;
      
      // If tension is not high, return quickly
      if (!detection.isHighTension) {
        const quickResult: EmotionalTensionResult = {
          detection,
          extraPassesRun: 0,
          clarifyingQuestionsGenerated: false,
          groundedResponse: proposedResponse,
          processingTime: Date.now() - startTime,
        };
        this.emit('processing-complete', quickResult);
        return quickResult;
      }

      // Layer ET2: Run extra passes and potentially ask clarifying questions
      const et2Result = await this.runET2Processing(
        input,
        proposedResponse,
        detection,
        context
      );

      // Layer ET3: Generate grounded, thoughtful response
      const groundedResponse = await this.runET3Grounding(
        input,
        et2Result.refinedResponse,
        detection,
        et2Result.clarifyingQuestions
      );

      const result: EmotionalTensionResult = {
        detection,
        extraPassesRun: et2Result.passesRun,
        clarifyingQuestionsGenerated: et2Result.clarifyingQuestions.length > 0,
        clarifyingQuestions: et2Result.clarifyingQuestions.length > 0 
          ? et2Result.clarifyingQuestions 
          : undefined,
        groundedResponse,
        processingTime: Date.now() - startTime,
      };

      this.emit('processing-complete', result);
      return result;

    } finally {
      this.processingActive = false;
      this.currentTensionBuffer = null;
    }
  }

  /**
   * Layer ET1: Detect Tension
   * 
   * Analyzes the input for:
   * - Topic tension (sensitive subjects)
   * - Tone tension (emotional language)
   * - Stakes tension (urgency, consequences)
   */
  private async runET1Detection(
    input: string,
    context?: Record<string, unknown>
  ): Promise<TensionDetection> {
    const lowerInput = input.toLowerCase();

    // Detect topic tension
    const topicTension = this.calculateTopicTension(lowerInput);

    // Detect tone tension
    const toneTension = this.calculateToneTension(input);

    // Detect stakes tension
    const stakesTension = this.calculateStakesTension(lowerInput, context);

    // Calculate overall tension (weighted average)
    const overallTension = (
      topicTension * 0.35 +
      toneTension * 0.35 +
      stakesTension * 0.30
    );

    const isHighTension = overallTension >= this.config.tensionThreshold;
    const suggestedPasses = this.calculateSuggestedPasses(overallTension);

    log.debug('ET1 tension detection complete', {
      topicTension,
      toneTension,
      stakesTension,
      overallTension,
      isHighTension,
    });

    return {
      topicTension,
      toneTension,
      stakesTension,
      overallTension,
      isHighTension,
      suggestedPasses,
    };
  }

  /**
   * Layer ET2: Increase Internal Passes
   * 
   * When tension is detected:
   * - Run additional processing passes
   * - Consider clarifying questions if uncertainty is high
   * - Refine the response with each pass
   */
  private async runET2Processing(
    input: string,
    proposedResponse: string,
    detection: TensionDetection,
    context?: Record<string, unknown>
  ): Promise<{
    passesRun: number;
    refinedResponse: string;
    clarifyingQuestions: string[];
  }> {
    let refinedResponse = proposedResponse;
    const clarifyingQuestions: string[] = [];
    const passesToRun = Math.min(detection.suggestedPasses, this.config.maxExtraPasses);

    for (let pass = 0; pass < passesToRun; pass++) {
      // Each pass refines the response further
      refinedResponse = this.refineResponsePass(refinedResponse, detection, pass);
      
      // Add small delay between passes to simulate "thinking"
      if (pass < passesToRun - 1) {
        await this.simulateThinkingPause(100);
      }
    }

    // Consider asking clarifying questions if enabled and appropriate
    if (this.config.askClarifyingQuestions && this.shouldAskClarifyingQuestions(detection, context)) {
      const questions = this.generateClarifyingQuestions(input, detection);
      clarifyingQuestions.push(...questions);
    }

    log.debug('ET2 processing complete', {
      passesRun: passesToRun,
      hasQuestions: clarifyingQuestions.length > 0,
    });

    return {
      passesRun: passesToRun,
      refinedResponse,
      clarifyingQuestions,
    };
  }

  /**
   * Layer ET3: Output Grounded Response
   * 
   * Produces a calmer, more precise, more thoughtful answer:
   * - Removes reactive language
   * - Adds appropriate empathy/acknowledgment
   * - Ensures response is grounded and measured
   */
  private async runET3Grounding(
    input: string,
    refinedResponse: string,
    detection: TensionDetection,
    clarifyingQuestions: string[]
  ): Promise<string> {
    // Add minimum response delay if configured
    if (this.config.minResponseDelay > 0) {
      await this.simulateThinkingPause(this.config.minResponseDelay);
    }

    let groundedResponse = refinedResponse;

    // Remove reactive language patterns
    groundedResponse = this.removeReactiveLanguage(groundedResponse);

    // Add appropriate acknowledgment if high emotional tension
    if (detection.toneTension >= 0.7) {
      groundedResponse = this.addEmotionalAcknowledgment(groundedResponse, detection);
    }

    // Add stakes acknowledgment if high stakes detected
    if (detection.stakesTension >= 0.7) {
      groundedResponse = this.addStakesAcknowledgment(groundedResponse);
    }

    // If clarifying questions were generated, integrate them thoughtfully
    if (clarifyingQuestions.length > 0) {
      groundedResponse = this.integrateClarifyingQuestions(groundedResponse, clarifyingQuestions);
    }

    // Final grounding pass
    groundedResponse = this.finalGroundingPass(groundedResponse);

    log.debug('ET3 grounding complete', {
      responseLength: groundedResponse.length,
    });

    return groundedResponse;
  }

  // ============================================================================
  // Tension Calculation Helpers
  // ============================================================================

  private calculateTopicTension(lowerInput: string): number {
    let tension = 0;
    let matchCount = 0;

    for (const topic of HIGH_TENSION_TOPICS) {
      if (lowerInput.includes(topic)) {
        matchCount++;
        tension += 0.2; // Each topic adds tension
      }
    }

    // Normalize to 0-1 range
    return Math.min(1, tension);
  }

  private calculateToneTension(input: string): number {
    let tension = 0;
    const lowerInput = input.toLowerCase();

    // Check for negative tone markers
    for (const marker of NEGATIVE_TONE_MARKERS) {
      if (input.includes(marker) || lowerInput.includes(marker.toLowerCase())) {
        tension += 0.15;
      }
    }

    // Check for ALL CAPS (shouting)
    const capsRatio = (input.match(/[A-Z]/g) || []).length / input.length;
    if (capsRatio > 0.5 && input.length > 20) {
      tension += 0.3;
    }

    // Check for excessive punctuation
    const exclamationCount = (input.match(/!/g) || []).length;
    if (exclamationCount >= 2) {
      tension += 0.1 * Math.min(exclamationCount, 5);
    }

    return Math.min(1, tension);
  }

  private calculateStakesTension(
    lowerInput: string,
    context?: Record<string, unknown>
  ): number {
    let tension = 0;

    // Check for high-stakes indicators
    for (const indicator of HIGH_STAKES_INDICATORS) {
      if (lowerInput.includes(indicator)) {
        tension += 0.2;
      }
    }

    // Context-based stakes (e.g., legal matters)
    if (context?.isLegalMatter) {
      tension += 0.3;
    }

    if (context?.isEmergency) {
      tension += 0.5;
    }

    return Math.min(1, tension);
  }

  private calculateSuggestedPasses(overallTension: number): number {
    if (overallTension < 0.4) return 0;
    if (overallTension < 0.6) return 1;
    if (overallTension < 0.8) return 2;
    return 3;
  }

  // ============================================================================
  // Response Refinement Helpers
  // ============================================================================

  private refineResponsePass(
    response: string,
    detection: TensionDetection,
    passNumber: number
  ): string {
    let refined = response;

    // Pass 0: Remove immediate reactions
    if (passNumber === 0) {
      refined = refined.replace(/^(Wow|Oh|Geez|Yikes|OMG)[,!]?\s*/i, '');
    }

    // Pass 1: Soften absolute language
    if (passNumber === 1) {
      refined = refined
        .replace(/\balways\b/gi, 'often')
        .replace(/\bnever\b/gi, 'rarely')
        .replace(/\babsolutely\b/gi, 'generally')
        .replace(/\bdefinitely\b/gi, 'likely');
    }

    // Pass 2: Add measured qualifiers where appropriate
    if (passNumber === 2) {
      if (!refined.includes('may') && !refined.includes('might') && !refined.includes('could')) {
        refined = refined.replace(/\byou should\b/gi, 'you might consider');
      }
    }

    return refined;
  }

  private shouldAskClarifyingQuestions(
    detection: TensionDetection,
    context?: Record<string, unknown>
  ): boolean {
    // Ask questions when uncertainty is high
    if (detection.overallTension >= 0.8) return true;
    
    // Ask when stakes are high and we need more info
    if (detection.stakesTension >= 0.7) return true;
    
    // Don't ask in emergency contexts - act first
    if (context?.isEmergency) return false;

    return detection.overallTension >= 0.65;
  }

  private generateClarifyingQuestions(
    input: string,
    detection: TensionDetection
  ): string[] {
    const questions: string[] = [];

    // High emotional tension - check on well-being
    if (detection.toneTension >= 0.8) {
      questions.push('Before I respond, I want to make sure I understand the situation correctly. Can you tell me more about what happened?');
    }

    // High stakes - confirm details
    if (detection.stakesTension >= 0.7) {
      questions.push('Given the urgency of this situation, I want to make sure I give you the most relevant guidance. Could you clarify the timeline we\'re working with?');
    }

    // Complex topic tension - seek clarity
    if (detection.topicTension >= 0.7 && questions.length < 2) {
      questions.push('This involves some sensitive considerations. What aspect of this is most important for me to address first?');
    }

    // Limit to 2 questions max to avoid overwhelming
    return questions.slice(0, 2);
  }

  // ============================================================================
  // Response Grounding Helpers
  // ============================================================================

  private removeReactiveLanguage(response: string): string {
    return response
      // Remove reactive interjections
      .replace(/^(Holy cow|My god|Good grief|Oh no)[,!]?\s*/i, '')
      // Remove dismissive language
      .replace(/\b(obviously|clearly|simply|just)\b/gi, '')
      // Remove aggressive qualifiers
      .replace(/\b(absolutely must|you need to immediately)\b/gi, 'it would be helpful to')
      // Clean up extra spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  private addEmotionalAcknowledgment(
    response: string,
    detection: TensionDetection
  ): string {
    // Only add if not already acknowledged
    const acknowledgmentPhrases = [
      'understand', 'hear', 'recognize', 'appreciate',
      'difficult', 'challenging', 'hard'
    ];

    const hasAcknowledgment = acknowledgmentPhrases.some(p => 
      response.toLowerCase().includes(p)
    );

    if (!hasAcknowledgment) {
      const acknowledgments = [
        'I understand this is a challenging situation.',
        'I recognize this may be difficult.',
        'I hear that this is weighing on you.',
      ];
      const acknowledgment = acknowledgments[Math.floor(detection.toneTension * acknowledgments.length)];
      return `${acknowledgment} ${response}`;
    }

    return response;
  }

  private addStakesAcknowledgment(response: string): string {
    // Acknowledge the importance without adding panic
    const hasUrgencyAck = response.toLowerCase().includes('important') || 
                          response.toLowerCase().includes('priority') ||
                          response.toLowerCase().includes('urgency');

    if (!hasUrgencyAck) {
      return `Given the importance of this, ${response.charAt(0).toLowerCase()}${response.slice(1)}`;
    }

    return response;
  }

  private integrateClarifyingQuestions(
    response: string,
    questions: string[]
  ): string {
    if (questions.length === 0) return response;

    // Add questions naturally at the end
    const questionSection = questions.join(' ');
    return `${response}\n\n${questionSection}`;
  }

  private finalGroundingPass(response: string): string {
    let grounded = response;

    // Ensure proper sentence structure
    if (!grounded.endsWith('.') && !grounded.endsWith('?') && !grounded.endsWith('!')) {
      grounded += '.';
    }

    // Remove any double spaces
    grounded = grounded.replace(/\s+/g, ' ');

    // Ensure proper capitalization at start
    grounded = grounded.charAt(0).toUpperCase() + grounded.slice(1);

    return grounded;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private async simulateThinkingPause(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration
   */
  getConfig(): EmotionalTensionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<EmotionalTensionConfig>): void {
    this.config = { ...this.config, ...updates };
    log.info('Emotional Tension config updated', { config: this.config });
  }

  /**
   * Get current tension buffer (if processing)
   */
  getCurrentTensionBuffer(): TensionDetection | null {
    return this.currentTensionBuffer;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if currently processing
   */
  isProcessing(): boolean {
    return this.processingActive;
  }

  /**
   * Quick tension check without full processing
   */
  quickTensionCheck(input: string): number {
    const lowerInput = input.toLowerCase();
    const topic = this.calculateTopicTension(lowerInput);
    const tone = this.calculateToneTension(input);
    const stakes = this.calculateStakesTension(lowerInput);
    return topic * 0.35 + tone * 0.35 + stakes * 0.30;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EmotionalTensionSystem | null = null;

export function getEmotionalTensionSystem(
  config?: Partial<EmotionalTensionConfig>
): EmotionalTensionSystem {
  if (!instance) {
    instance = new EmotionalTensionSystem(config);
  }
  return instance;
}

export function resetEmotionalTensionSystem(): void {
  instance = null;
}

export default EmotionalTensionSystem;
