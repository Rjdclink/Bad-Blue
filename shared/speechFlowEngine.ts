/**
 * SpeechFlow Rendering Engine
 * Stage 12: Natural Legal Dialogue Transformation
 * 
 * Transforms text responses into believable spoken communication with:
 * - Conceptual segmentation
 * - Realistic pauses
 * - Prosody and rhythm controls
 * - Natural inflection and emphasis
 * - SSML-like markup generation
 */

import { LEXARA_VOICE_PERSONA, type SpeechContext } from './lexaraVoicePersona';

/**
 * SSML-like Break Types
 */
export type BreakStrength = 'none' | 'x-weak' | 'weak' | 'medium' | 'strong' | 'x-strong';
export type BreakTime = `${number}ms` | `${number}s`;

/**
 * Prosody Attributes
 */
export interface ProsodyAttributes {
  rate?: 'x-slow' | 'slow' | 'medium' | 'fast' | 'x-fast' | `${number}%`;
  pitch?: 'x-low' | 'low' | 'medium' | 'high' | 'x-high' | `${number}Hz` | `${number}%`;
  volume?: 'silent' | 'x-soft' | 'soft' | 'medium' | 'loud' | 'x-loud' | `${number}dB`;
}

/**
 * Emphasis Levels
 */
export type EmphasisLevel = 'none' | 'reduced' | 'moderate' | 'strong';

/**
 * Speech Segment with Metadata
 */
export interface SpeechSegment {
  text: string;
  type: 'statement' | 'question' | 'list-item' | 'emphasis' | 'transition' | 'citation' | 'conclusion';
  context?: SpeechContext;
  prosody?: ProsodyAttributes;
  emphasis?: EmphasisLevel;
  pauseAfter?: BreakTime;
  pauseBefore?: BreakTime;
}

/**
 * SpeechFlow Output
 */
export interface SpeechFlowOutput {
  segments: SpeechSegment[];
  ssml: string;
  plainText: string;
  estimatedDuration: number; // in milliseconds
}

/**
 * SpeechFlow Configuration
 */
interface SpeechFlowConfig {
  enablePauses: boolean;
  enableProsody: boolean;
  enableEmphasis: boolean;
  optimizeForLegal: boolean;
  targetProvider: 'ssml' | 'elevenlabs' | 'polly' | 'azure' | 'browser';
}

const DEFAULT_CONFIG: SpeechFlowConfig = {
  enablePauses: true,
  enableProsody: true,
  enableEmphasis: true,
  optimizeForLegal: true,
  targetProvider: 'ssml',
};

/**
 * SpeechFlow Engine Class
 */
export class SpeechFlowEngine {
  private config: SpeechFlowConfig;
  private persona = LEXARA_VOICE_PERSONA;

  constructor(config: Partial<SpeechFlowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main transformation method: Convert text to natural speech segments
   */
  public transformToSpeech(
    text: string,
    context: SpeechContext = 'explanation'
  ): SpeechFlowOutput {
    // Step 1: Segment the text into conceptual units
    const segments = this.segmentText(text, context);

    // Step 2: Apply prosody and rhythm controls
    const enhancedSegments = this.applyProsody(segments, context);

    // Step 3: Insert realistic pauses
    const pausedSegments = this.insertPauses(enhancedSegments);

    // Step 4: Add emphasis and inflection
    const finalSegments = this.addEmphasis(pausedSegments);

    // Step 5: Generate SSML markup
    const ssml = this.generateSSML(finalSegments);

    // Step 6: Calculate estimated duration
    const duration = this.estimateDuration(finalSegments);

    return {
      segments: finalSegments,
      ssml,
      plainText: text,
      estimatedDuration: duration,
    };
  }

  /**
   * Segment text into conceptual units for natural speech
   */
  private segmentText(text: string, context: SpeechContext): SpeechSegment[] {
    const segments: SpeechSegment[] = [];

    // Split by paragraphs first
    const paragraphs = text.split(/\n\n+/);

    for (const para of paragraphs) {
      // Split into sentences
      const sentences = this.splitIntoSentences(para);

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim();
        if (!sentence) continue;

        const segment: SpeechSegment = {
          text: sentence,
          type: this.detectSentenceType(sentence),
          context,
        };

        segments.push(segment);
      }
    }

    return segments;
  }

  /**
   * Split text into sentences, handling legal citations and abbreviations
   */
  private splitIntoSentences(text: string): string[] {
    // Protect legal citations and abbreviations
    const protectedText = text
      .replace(/(\d+)\s+(U\.S\.|F\.2d|F\.3d|F\.Supp\.|S\.Ct\.)/g, '$1_$2')
      .replace(/\b(vs\.|v\.|Inc\.|Corp\.|Ltd\.|LLC\.|Dr\.|Mr\.|Mrs\.|Ms\.)/gi, (match) =>
        match.replace(/\./g, '_DOT_')
      );

    // Split on sentence endings
    const sentences = protectedText.split(/(?<=[.!?])\s+(?=[A-Z])/);

    // Restore protected text
    return sentences.map(s =>
      s
        .replace(/_/g, ' ')
        .replace(/_DOT_/g, '.')
        .trim()
    );
  }

  /**
   * Detect the type of sentence for appropriate handling
   */
  private detectSentenceType(sentence: string): SpeechSegment['type'] {
    if (sentence.endsWith('?')) return 'question';
    if (sentence.match(/first|second|third|next|finally|additionally/i)) return 'list-item';
    if (sentence.match(/\d+\s+(U\.S\.|F\.\d+d|S\.Ct\.)/)) return 'citation';
    if (sentence.match(/therefore|thus|in conclusion|accordingly/i)) return 'conclusion';
    if (sentence.match(/now|next|moving|turning to|with respect to/i)) return 'transition';
    if (sentence.match(/importantly?|crucially?|significantly?|notably?/i)) return 'emphasis';
    return 'statement';
  }

  /**
   * Apply prosody controls based on context and sentence type
   */
  private applyProsody(segments: SpeechSegment[], context: SpeechContext): SpeechSegment[] {
    if (!this.config.enableProsody) return segments;

    return segments.map(segment => {
      const prosody: ProsodyAttributes = {};

      // Adjust based on context
      switch (context) {
        case 'evaluation':
          prosody.rate = '95%'; // Slightly slower for authority
          prosody.pitch = 'medium';
          break;
        case 'explanation':
          prosody.rate = 'medium';
          prosody.pitch = 'medium';
          break;
        case 'guidance':
          prosody.rate = '105%'; // Slightly faster for encouragement
          prosody.pitch = 'medium';
          break;
        case 'reassurance':
          prosody.rate = '90%'; // Slower for empathy
          prosody.pitch = 'medium';
          break;
      }

      // Adjust based on sentence type
      switch (segment.type) {
        case 'question':
          prosody.pitch = 'high'; // Rising inflection
          break;
        case 'emphasis':
          prosody.volume = 'loud';
          prosody.rate = '95%';
          break;
        case 'citation':
          prosody.rate = '85%'; // Slower for clarity
          break;
        case 'conclusion':
          prosody.pitch = 'low'; // Falling inflection
          prosody.volume = 'medium';
          break;
      }

      return { ...segment, prosody };
    });
  }

  /**
   * Insert realistic pauses for natural speech rhythm
   */
  private insertPauses(segments: SpeechSegment[]): SpeechSegment[] {
    if (!this.config.enablePauses) return segments;

    const pausePatterns = this.persona.conversational.pausePatterns;

    return segments.map((segment, index) => {
      const isLast = index === segments.length - 1;
      let pauseAfter: BreakTime | undefined;

      // Default sentence pause
      pauseAfter = `${pausePatterns.sentenceEnd}ms`;

      // Adjust based on type
      switch (segment.type) {
        case 'transition':
          pauseAfter = `${pausePatterns.thoughtTransition}ms`;
          break;
        case 'emphasis':
          segment.pauseBefore = `${pausePatterns.emphasis}ms`;
          break;
        case 'list-item':
          pauseAfter = `${pausePatterns.clauseEnd}ms`;
          break;
        case 'citation':
          pauseAfter = `${pausePatterns.thoughtTransition}ms`;
          break;
        case 'conclusion':
          if (isLast) {
            pauseAfter = `${pausePatterns.thoughtTransition}ms`;
          }
          break;
      }

      return { ...segment, pauseAfter };
    });
  }

  /**
   * Add emphasis markers for key terms and phrases
   */
  private addEmphasis(segments: SpeechSegment[]): SpeechSegment[] {
    if (!this.config.enableEmphasis) return segments;

    return segments.map(segment => {
      const text = segment.text;

      // Legal terms that should be emphasized
      const emphasisPatterns = [
        /\b(must|shall|required|mandatory|prohibited)\b/gi,
        /\b(important|significant|crucial|critical|key)\b/gi,
        /\b(violation|breach|liability|negligence)\b/gi,
        /\b(constitutional|federal|statutory)\b/gi,
        /\b(plaintiff|defendant|jurisdiction)\b/gi,
      ];

      let hasEmphasis = false;
      for (const pattern of emphasisPatterns) {
        if (pattern.test(text)) {
          hasEmphasis = true;
          break;
        }
      }

      if (hasEmphasis || segment.type === 'emphasis') {
        return {
          ...segment,
          emphasis: segment.type === 'emphasis' ? 'strong' : 'moderate',
        };
      }

      return segment;
    });
  }

  /**
   * Generate SSML markup from segments
   */
  private generateSSML(segments: SpeechSegment[]): string {
    let ssml = '<speak>';

    for (const segment of segments) {
      let segmentSSML = segment.text;

      // Wrap in prosody if present
      if (segment.prosody) {
        const attrs = Object.entries(segment.prosody)
          .map(([key, value]) => `${key}="${value}"`)
          .join(' ');
        segmentSSML = `<prosody ${attrs}>${segmentSSML}</prosody>`;
      }

      // Add emphasis if present
      if (segment.emphasis && segment.emphasis !== 'none') {
        segmentSSML = `<emphasis level="${segment.emphasis}">${segmentSSML}</emphasis>`;
      }

      // Add pause before if specified
      if (segment.pauseBefore) {
        ssml += `<break time="${segment.pauseBefore}"/>`;
      }

      ssml += segmentSSML;

      // Add pause after if specified
      if (segment.pauseAfter) {
        ssml += `<break time="${segment.pauseAfter}"/>`;
      }
    }

    ssml += '</speak>';
    return ssml;
  }

  /**
   * Estimate total speech duration
   */
  private estimateDuration(segments: SpeechSegment[]): number {
    const baseRate = this.persona.prosody.rate.base; // words per minute
    let totalWords = 0;
    let totalPauses = 0;

    for (const segment of segments) {
      // Count words
      const words = segment.text.split(/\s+/).length;
      totalWords += words;

      // Account for rate adjustments
      if (segment.prosody?.rate) {
        const rateMatch = segment.prosody.rate.match(/(\d+)%/);
        if (rateMatch) {
          const rateFactor = parseInt(rateMatch[1], 10) / 100;
          // Adjust word count: faster rate = less time, so divide by rateFactor
          totalWords = totalWords / rateFactor;
        }
      }

      // Add pauses
      if (segment.pauseAfter) {
        const pauseMs = parseInt(segment.pauseAfter, 10);
        totalPauses += pauseMs;
      }
      if (segment.pauseBefore) {
        const pauseMs = parseInt(segment.pauseBefore, 10);
        totalPauses += pauseMs;
      }
    }

    // Calculate speaking time (convert WPM to ms)
    const speakingTime = (totalWords / baseRate) * 60 * 1000;

    return Math.round(speakingTime + totalPauses);
  }

  /**
   * Utility: Convert text for auditory comprehension
   * Simplifies sentence structure for spoken delivery
   */
  public optimizeForAuditory(text: string): string {
    // Break long sentences into shorter units
    let optimized = text
      // Replace semicolons with periods for clearer breaks
      .replace(/;\s+/g, '. ')
      // Expand contractions for clarity
      .replace(/won't/gi, 'will not')
      .replace(/can't/gi, 'cannot')
      .replace(/shouldn't/gi, 'should not')
      .replace(/wouldn't/gi, 'would not')
      .replace(/hasn't/gi, 'has not')
      .replace(/haven't/gi, 'have not')
      .replace(/isn't/gi, 'is not')
      .replace(/aren't/gi, 'are not')
      .replace(/wasn't/gi, 'was not')
      .replace(/weren't/gi, 'were not')
      // Add verbal transitions
      .replace(/\bHowever,/g, 'However, it is important to note that')
      .replace(/\bTherefore,/g, 'Therefore, we can conclude that')
      .replace(/\bAdditionally,/g, 'Additionally, you should know that');

    return optimized;
  }

  /**
   * Add conversational transitions
   */
  public addTransitions(segments: string[]): string[] {
    const transitions = this.persona.conversational.transitionPhrases;
    const result: string[] = [];

    segments.forEach((segment, index) => {
      if (index > 0 && index < segments.length - 1) {
        // Add transition before middle segments
        const transition = transitions[index % transitions.length];
        result.push(`${transition}, ${segment}`);
      } else {
        result.push(segment);
      }
    });

    return result;
  }
}

/**
 * Convenience function for quick speech transformation
 */
export function textToSpeech(
  text: string,
  context: SpeechContext = 'explanation',
  config?: Partial<SpeechFlowConfig>
): SpeechFlowOutput {
  const engine = new SpeechFlowEngine(config);
  return engine.transformToSpeech(text, context);
}

/**
 * Extract plain text from SSML
 * Safely removes all XML/SSML tags and normalizes whitespace
 */
export function ssmlToPlainText(ssml: string): string {
  // First pass: remove all XML/SSML tags completely
  let text = ssml.replace(/<[^>]*>/g, '');
  
  // Second pass: handle any remaining < or > characters (malformed tags)
  text = text.replace(/</g, '').replace(/>/g, '');
  
  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}
