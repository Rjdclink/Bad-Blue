/**
 * LEXARA VOICE FORGE
 * 
 * A Monte Carlo–driven engine that searches, mutates, and locks in one stable
 * "Lexara" voice profile: young female timbre (18-20) + centuries-deep court
 * experience + calm, surgical clarity.
 * 
 * This is NOT a side toy - it's a core optimization module that integrates with
 * the existing Monte Carlo and evolution infrastructure.
 * 
 * Architecture:
 * 1. Voice Candidate System - Config vectors over (engine, voice_id, pitch, etc.)
 * 2. Lexara Persona Rewriter - Text transformation before TTS
 * 3. Monte Carlo Voice Search Loop - Sample, score, select, mutate, iterate
 * 4. Auto-Scoring System - Clarity, age/tone, persona consistency, comfort
 * 5. Freeze/Lock Mechanism - Canonize the best profile as immutable
 * 
 * The goal: A young, articulate, deeply experienced courtroom mind speaking
 * through free engines (Coqui/Piper) that sounds like a single consistent persona.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import crypto from 'crypto';

const log = createLogger('LexaraVoiceForge');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Voice Engine Types - Free/Open Source Only
 */
export type VoiceEngine = 'coqui' | 'piper';

/**
 * Post-Processing Effect Profile
 * Defines the audio post-chain applied to all TTS output
 */
export interface PostFXProfile {
  /** EQ tilt: -1.0 (darker) to +1.0 (brighter) */
  eqTilt: number;
  /** Compression threshold in dB (-60 to 0) */
  compressionThreshold: number;
  /** Compression ratio (1.0 to 20.0) */
  compressionRatio: number;
  /** Reverb amount: 0.0 (dry) to 1.0 (wet) */
  reverbAmount: number;
  /** Reverb room size: 0.0 (small) to 1.0 (large) */
  reverbRoomSize: number;
  /** De-esser strength: 0.0 to 1.0 */
  deEsser: number;
}

/**
 * Pause Pattern Configuration
 * Controls punctuation and pause placement for natural speech
 */
export interface PausePattern {
  /** Comma pause duration in ms */
  commaPause: number;
  /** Period pause duration in ms */
  periodPause: number;
  /** Ellipsis pause duration in ms */
  ellipsisPause: number;
  /** Semicolon pause duration in ms */
  semicolonPause: number;
  /** Question mark pause duration in ms */
  questionPause: number;
  /** Exclamation pause duration in ms */
  exclamationPause: number;
  /** Paragraph break pause duration in ms */
  paragraphPause: number;
}

/**
 * Voice Candidate - A single "Lexara voice attempt"
 * Each candidate uses the same Lexara persona in text (style_prompt)
 * but with different engine, speaker, pitch, rate, energy, etc.
 */
export interface VoiceCandidate {
  /** Unique identifier for this candidate */
  id: string;
  /** TTS engine: coqui (quality) or piper (fast) */
  engine: VoiceEngine;
  /** Engine-specific speaker/model identifier */
  voiceId: string;
  /** Pitch adjustment: 0.5 (lower) to 2.0 (higher), 1.0 = neutral */
  pitch: number;
  /** Speaking rate: 0.5 (slower) to 2.0 (faster), 1.0 = neutral */
  rate: number;
  /** Energy/emphasis level: 0.0 to 1.0 */
  energy: number;
  /** Lexara persona style prompt - how she phrases things */
  stylePrompt: string;
  /** Pause pattern configuration */
  pausePattern: PausePattern;
  /** Post-processing chain profile */
  postFXProfile: PostFXProfile;
  /** Generation number this candidate was created in */
  generation: number;
  /** Parent candidate ID if mutated from another */
  parentId?: string;
  /** Mutation delta from parent */
  mutationDelta?: Record<string, number>;
}

/**
 * Candidate Fitness Scores
 */
export interface CandidateFitness {
  /** Overall fitness score (0-1) */
  overall: number;
  /** Clarity/intelligibility score (0-1) */
  clarity: number;
  /** Persona consistency score (0-1) */
  personaScore: number;
  /** Age band match score (0-1) - targeting 18-20 female */
  ageMatchScore: number;
  /** Comfort score (0-1) - not too high-pitched, nasal, robotic */
  comfortScore: number;
  /** Spectral quality score (0-1) */
  spectralQuality: number;
  /** Timestamp of evaluation */
  evaluatedAt: Date;
}

/**
 * Evaluated Voice Candidate
 */
export interface EvaluatedCandidate {
  candidate: VoiceCandidate;
  fitness: CandidateFitness;
  testClips: TestClipResult[];
  rank: number;
}

/**
 * Test Clip Result
 */
export interface TestClipResult {
  type: 'statute' | 'summary' | 'boundary' | 'reassurance';
  originalText: string;
  processedText: string;
  audioHash?: string;
  wordErrorRate?: number;
  spectralClarity?: number;
  asrTranscript?: string;
  personaMatchScore?: number;
}

/**
 * Frozen Voice Profile - The canonical Lexara voice
 */
export interface FrozenVoiceProfile {
  /** Profile version identifier */
  version: string;
  /** The winning candidate configuration */
  candidate: VoiceCandidate;
  /** Final fitness scores */
  fitness: CandidateFitness;
  /** When this profile was frozen */
  frozenAt: Date;
  /** Which generation produced this winner */
  generation: number;
  /** Total candidates evaluated to find this winner */
  totalEvaluated: number;
  /** Whether this is the active production profile */
  isActive: boolean;
  /** Optional human verification status */
  humanVerified?: boolean;
  /** Notes from the freezing process */
  notes?: string;
}

/**
 * Voice Forge Configuration
 */
export interface VoiceForgeConfig {
  /** Number of candidates per generation */
  populationSize: number;
  /** Number of generations to run */
  maxGenerations: number;
  /** Top K candidates to keep per generation */
  eliteCount: number;
  /** Fresh random candidates to inject per generation */
  freshInjectionCount: number;
  /** Mutation rate (0-1) */
  mutationRate: number;
  /** Mutation magnitude for numeric parameters */
  mutationMagnitude: number;
  /** Fitness threshold to trigger early freeze */
  earlyFreezeThreshold: number;
  /** Convergence threshold (variance) to stop */
  convergenceThreshold: number;
  /** Bias toward Coqui engine (0-1) */
  coquiBias: number;
}

/**
 * Voice Forge State
 */
export interface VoiceForgeState {
  isRunning: boolean;
  currentGeneration: number;
  totalEvaluated: number;
  bestFitness: number;
  currentElite: EvaluatedCandidate[];
  frozenProfiles: FrozenVoiceProfile[];
  activeProfile: FrozenVoiceProfile | null;
  lastRunAt: Date | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default Voice Forge Configuration
 */
const DEFAULT_CONFIG: VoiceForgeConfig = {
  populationSize: 20,
  maxGenerations: 10,
  eliteCount: 5,
  freshInjectionCount: 3,
  mutationRate: 0.3,
  mutationMagnitude: 0.15,
  earlyFreezeThreshold: 0.92,
  convergenceThreshold: 0.01,
  coquiBias: 0.7, // Prefer Coqui for quality
};

/**
 * Default Pause Pattern - Natural legal speech cadence
 */
const DEFAULT_PAUSE_PATTERN: PausePattern = {
  commaPause: 200,
  periodPause: 400,
  ellipsisPause: 600,
  semicolonPause: 300,
  questionPause: 450,
  exclamationPause: 350,
  paragraphPause: 800,
};

/**
 * Default Post-FX Profile - Warm, professional, slightly reverbed
 */
const DEFAULT_POST_FX: PostFXProfile = {
  eqTilt: 0.1,           // Slightly bright
  compressionThreshold: -18,
  compressionRatio: 3.0,
  reverbAmount: 0.15,
  reverbRoomSize: 0.3,
  deEsser: 0.4,
};

/**
 * Available Coqui Voice IDs (free voices)
 */
const COQUI_VOICES = [
  'tts_models/en/ljspeech/tacotron2-DDC',
  'tts_models/en/ljspeech/glow-tts',
  'tts_models/en/ljspeech/speedy-speech',
  'tts_models/en/vctk/vits',
  'tts_models/en/jenny/jenny',
];

/**
 * Available Piper Voice IDs (fast voices)
 */
const PIPER_VOICES = [
  'en_US-amy-medium',
  'en_US-lessac-medium',
  'en_US-libritts-high',
  'en_GB-alba-medium',
  'en_GB-jenny_dioco-medium',
];

/**
 * Lexara Persona Style Prompts - Variations to test
 */
const LEXARA_STYLE_PROMPTS = [
  // Base Lexara persona
  `Young, articulate legal mind with centuries of courtroom experience. 
   Speaks with calm surgical clarity. Precise word choice. 
   Organized thoughts delivered with gentle authority.`,
  
  // Emphasis on youth + experience paradox
  `18-year-old voice carrying ancient wisdom of the courts.
   Fresh and vibrant delivery, yet every word chosen as if by 
   a Supreme Court Justice who has seen every case since Athens.`,
  
  // Focus on clarity and organization
  `Crystal-clear articulation with deliberate pacing.
   Each sentence a well-constructed legal argument.
   Pauses for emphasis at key points. Never rushed.`,
  
  // Warmth + authority balance
  `Warm but not casual. Authoritative but not cold.
   The voice of a young legal prodigy explaining complex matters
   with patience and genuine care for understanding.`,
  
  // Gravitas with youthful energy
  `The gravitas of a Supreme Court Justice combined with
   the fresh energy of a brilliant young advocate.
   Confident, measured, reassuringly competent.`,
];

/**
 * Test Phrases for Voice Evaluation
 */
const TEST_PHRASES = {
  statute: [
    "Under Section 1983 of Title 42, United States Code, any person who, under color of state law, subjects another to the deprivation of constitutional rights shall be liable.",
    "The Fourth Amendment protects individuals from unreasonable searches and seizures, requiring probable cause and particularity in warrants.",
  ],
  summary: [
    "In summary, your case presents three key issues: first, the procedural violations; second, the substantive claims; and third, the available remedies.",
    "Let me break this down clearly. The statute of limitations is two years. You have documented evidence. The liability appears clear.",
  ],
  boundary: [
    "I need to be clear: I can provide legal information, but I am not your attorney. For specific legal advice, you must consult a licensed lawyer in your jurisdiction.",
    "While I can explain these concepts thoroughly, the decision to proceed must be yours, made with full understanding of the risks involved.",
  ],
  reassurance: [
    "I understand this situation feels overwhelming. Let's work through it step by step, and I'll explain each part as we go.",
    "You're asking exactly the right questions. Many people in your situation feel uncertain, and that's completely normal.",
  ],
};

// ============================================================================
// LEXARA PERSONA REWRITER
// ============================================================================

/**
 * Lexara Persona Rewriter
 * 
 * Transforms raw content into Lexara-style text BEFORE TTS.
 * This is the "brain" that makes even basic TTS sound like Lexara.
 * 
 * Features:
 * - Precise word choice
 * - Calm, organized phrasing
 * - Court experience embedded in structure
 * - Appropriate pauses and emphasis markers
 */
export class LexaraPersonaRewriter {
  private stylePrompt: string;
  private pausePattern: PausePattern;
  
  constructor(stylePrompt: string, pausePattern: PausePattern = DEFAULT_PAUSE_PATTERN) {
    this.stylePrompt = stylePrompt;
    this.pausePattern = pausePattern;
  }
  
  /**
   * Rewrite text in Lexara's voice
   */
  rewrite(text: string): string {
    let processed = text;
    
    // 1. Clean and normalize
    processed = this.normalize(processed);
    
    // 2. Apply legal phrasing patterns
    processed = this.applyLegalPhrasing(processed);
    
    // 3. Insert appropriate pauses
    processed = this.insertPauses(processed);
    
    // 4. Add emphasis markers for key terms
    processed = this.addEmphasis(processed);
    
    // 5. Ensure calm, organized structure
    processed = this.organizeStructure(processed);
    
    return processed;
  }
  
  /**
   * Normalize text - clean up irregularities
   */
  private normalize(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\.{4,}/g, '...')
      .replace(/!{2,}/g, '!')
      .replace(/\?{2,}/g, '?')
      .trim();
  }
  
  /**
   * Apply legal phrasing patterns
   */
  private applyLegalPhrasing(text: string): string {
    // Replace casual phrases with legal-professional equivalents
    const replacements: [RegExp, string][] = [
      [/\bbasically\b/gi, 'essentially'],
      [/\bkinda\b/gi, 'somewhat'],
      [/\bgonna\b/gi, 'going to'],
      [/\bwanna\b/gi, 'want to'],
      [/\bgotta\b/gi, 'need to'],
      [/\blike,?\s+/gi, ''],
      [/\byou know,?\s*/gi, ''],
      [/\bI mean,?\s*/gi, ''],
      [/\bstuff\b/gi, 'matters'],
      [/\bthings\b/gi, 'matters'],
      [/\bguy\b/gi, 'individual'],
      [/\bguys\b/gi, 'individuals'],
      [/\bcops?\b/gi, 'law enforcement'],
      [/\bjail\b/gi, 'detention facility'],
      [/\blocked up\b/gi, 'incarcerated'],
      [/\bsue\b/gi, 'pursue legal action against'],
    ];
    
    let result = text;
    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }
    
    return result;
  }
  
  /**
   * Insert pause markers based on punctuation
   */
  private insertPauses(text: string): string {
    // For TTS engines that support SSML-style pauses
    // These will be converted to actual SSML by the TTS layer
    return text
      .replace(/\.\.\./g, `<pause ms="${this.pausePattern.ellipsisPause}"/>`)
      .replace(/\./g, `.<pause ms="${this.pausePattern.periodPause}"/>`)
      .replace(/,/g, `,<pause ms="${this.pausePattern.commaPause}"/>`)
      .replace(/;/g, `;<pause ms="${this.pausePattern.semicolonPause}"/>`)
      .replace(/\?/g, `?<pause ms="${this.pausePattern.questionPause}"/>`)
      .replace(/!/g, `!<pause ms="${this.pausePattern.exclamationPause}"/>`)
      .replace(/\n\n/g, `\n\n<pause ms="${this.pausePattern.paragraphPause}"/>`);
  }
  
  /**
   * Add emphasis markers for legal terms
   */
  private addEmphasis(text: string): string {
    const emphasisTerms = [
      'constitutional', 'rights', 'liability', 'damages', 'remedy',
      'jurisdiction', 'statute', 'precedent', 'ruling', 'verdict',
      'evidence', 'testimony', 'plaintiff', 'defendant', 'court',
      'judge', 'jury', 'attorney', 'counsel', 'legal', 'law',
      'amendment', 'due process', 'equal protection', 'civil rights',
    ];
    
    let result = text;
    for (const term of emphasisTerms) {
      const regex = new RegExp(`\\b(${term})\\b`, 'gi');
      result = result.replace(regex, '<emphasis>$1</emphasis>');
    }
    
    return result;
  }
  
  /**
   * Organize structure for clarity
   */
  private organizeStructure(text: string): string {
    // Add transitional phrases for numbered points
    let result = text;
    
    // If text has numbered points, ensure proper transitions
    result = result.replace(/\b(\d+)\.\s/g, (match, num) => {
      const transitions = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
      const idx = parseInt(num) - 1;
      if (idx >= 0 && idx < transitions.length) {
        return `${transitions[idx]}, `;
      }
      return match;
    });
    
    return result;
  }
  
  /**
   * Generate SSML from processed text
   */
  toSSML(text: string): string {
    const processed = this.rewrite(text);
    
    return `<speak>
      <prosody rate="medium" pitch="medium">
        ${processed}
      </prosody>
    </speak>`;
  }
}

// ============================================================================
// VOICE CANDIDATE GENERATOR
// ============================================================================

/**
 * Generate a random voice candidate
 */
function generateRandomCandidate(generation: number, config: VoiceForgeConfig): VoiceCandidate {
  const id = `vc-${generation}-${crypto.randomBytes(4).toString('hex')}`;
  
  // Engine selection with Coqui bias
  const engine: VoiceEngine = Math.random() < config.coquiBias ? 'coqui' : 'piper';
  
  // Voice ID based on engine
  const voicePool = engine === 'coqui' ? COQUI_VOICES : PIPER_VOICES;
  const voiceId = voicePool[Math.floor(Math.random() * voicePool.length)];
  
  // Random style prompt
  const stylePrompt = LEXARA_STYLE_PROMPTS[Math.floor(Math.random() * LEXARA_STYLE_PROMPTS.length)];
  
  // Randomize parameters within reasonable ranges for young female voice
  return {
    id,
    engine,
    voiceId,
    pitch: 1.0 + (Math.random() - 0.5) * 0.4,      // 0.8 to 1.2
    rate: 0.95 + Math.random() * 0.2,               // 0.95 to 1.15
    energy: 0.5 + Math.random() * 0.4,              // 0.5 to 0.9
    stylePrompt,
    pausePattern: {
      commaPause: 150 + Math.random() * 100,
      periodPause: 350 + Math.random() * 150,
      ellipsisPause: 500 + Math.random() * 200,
      semicolonPause: 250 + Math.random() * 100,
      questionPause: 400 + Math.random() * 100,
      exclamationPause: 300 + Math.random() * 100,
      paragraphPause: 700 + Math.random() * 200,
    },
    postFXProfile: {
      eqTilt: (Math.random() - 0.5) * 0.6,          // -0.3 to +0.3
      compressionThreshold: -24 + Math.random() * 12, // -24 to -12
      compressionRatio: 2 + Math.random() * 4,      // 2 to 6
      reverbAmount: 0.1 + Math.random() * 0.2,      // 0.1 to 0.3
      reverbRoomSize: 0.2 + Math.random() * 0.3,    // 0.2 to 0.5
      deEsser: 0.3 + Math.random() * 0.4,           // 0.3 to 0.7
    },
    generation,
  };
}

/**
 * Mutate a candidate to create offspring
 */
function mutateCandidate(
  parent: VoiceCandidate, 
  generation: number, 
  config: VoiceForgeConfig
): VoiceCandidate {
  const id = `vc-${generation}-${crypto.randomBytes(4).toString('hex')}`;
  const mutationDelta: Record<string, number> = {};
  
  // Helper to mutate numeric value
  const mutateValue = (value: number, key: string, min: number, max: number): number => {
    if (Math.random() > config.mutationRate) return value;
    const delta = (Math.random() - 0.5) * 2 * config.mutationMagnitude * (max - min);
    mutationDelta[key] = delta;
    return Math.max(min, Math.min(max, value + delta));
  };
  
  // Maybe switch engine
  let engine = parent.engine;
  let voiceId = parent.voiceId;
  if (Math.random() < 0.1) {
    engine = engine === 'coqui' ? 'piper' : 'coqui';
    const voicePool = engine === 'coqui' ? COQUI_VOICES : PIPER_VOICES;
    voiceId = voicePool[Math.floor(Math.random() * voicePool.length)];
  }
  
  // Maybe switch style prompt
  let stylePrompt = parent.stylePrompt;
  if (Math.random() < 0.15) {
    stylePrompt = LEXARA_STYLE_PROMPTS[Math.floor(Math.random() * LEXARA_STYLE_PROMPTS.length)];
  }
  
  return {
    id,
    engine,
    voiceId,
    pitch: mutateValue(parent.pitch, 'pitch', 0.7, 1.4),
    rate: mutateValue(parent.rate, 'rate', 0.8, 1.3),
    energy: mutateValue(parent.energy, 'energy', 0.3, 1.0),
    stylePrompt,
    pausePattern: {
      commaPause: mutateValue(parent.pausePattern.commaPause, 'commaPause', 100, 300),
      periodPause: mutateValue(parent.pausePattern.periodPause, 'periodPause', 250, 600),
      ellipsisPause: mutateValue(parent.pausePattern.ellipsisPause, 'ellipsisPause', 400, 800),
      semicolonPause: mutateValue(parent.pausePattern.semicolonPause, 'semicolonPause', 200, 400),
      questionPause: mutateValue(parent.pausePattern.questionPause, 'questionPause', 350, 550),
      exclamationPause: mutateValue(parent.pausePattern.exclamationPause, 'exclamationPause', 250, 450),
      paragraphPause: mutateValue(parent.pausePattern.paragraphPause, 'paragraphPause', 600, 1000),
    },
    postFXProfile: {
      eqTilt: mutateValue(parent.postFXProfile.eqTilt, 'eqTilt', -0.5, 0.5),
      compressionThreshold: mutateValue(parent.postFXProfile.compressionThreshold, 'compThresh', -30, -10),
      compressionRatio: mutateValue(parent.postFXProfile.compressionRatio, 'compRatio', 1.5, 8),
      reverbAmount: mutateValue(parent.postFXProfile.reverbAmount, 'reverbAmt', 0.05, 0.4),
      reverbRoomSize: mutateValue(parent.postFXProfile.reverbRoomSize, 'reverbRoom', 0.1, 0.6),
      deEsser: mutateValue(parent.postFXProfile.deEsser, 'deEsser', 0.2, 0.8),
    },
    generation,
    parentId: parent.id,
    mutationDelta,
  };
}

// ============================================================================
// VOICE CANDIDATE SCORER
// ============================================================================

/**
 * Score a voice candidate
 * 
 * Combines multiple scoring dimensions:
 * 1. Clarity (30%) - Intelligibility and word error rate
 * 2. Persona Score (30%) - How much it sounds like Lexara
 * 3. Age Match (20%) - Target: 18-20 female, not childish/elderly
 * 4. Comfort (20%) - Not too high-pitched, nasal, robotic, flat
 */
async function scoreCandidate(
  candidate: VoiceCandidate,
  testClips: TestClipResult[]
): Promise<CandidateFitness> {
  // Simulate scoring (in production, these would be actual measurements)
  // For now, we use heuristic scoring based on candidate parameters
  
  // Clarity score based on rate and pause patterns
  const clarityBase = 0.7;
  const rateBonus = candidate.rate >= 0.9 && candidate.rate <= 1.1 ? 0.15 : 0;
  const pauseBonus = candidate.pausePattern.periodPause >= 350 ? 0.1 : 0;
  const clarity = Math.min(1, clarityBase + rateBonus + pauseBonus + Math.random() * 0.1);
  
  // Persona score based on style prompt and energy
  const personaBase = 0.6;
  const styleBonus = candidate.stylePrompt.includes('court') ? 0.1 : 0;
  const energyBonus = candidate.energy >= 0.5 && candidate.energy <= 0.8 ? 0.15 : 0;
  const personaScore = Math.min(1, personaBase + styleBonus + energyBonus + Math.random() * 0.15);
  
  // Age match score - prefer pitch slightly above neutral for young female
  const idealPitch = 1.05; // Slightly higher for young female
  const pitchDelta = Math.abs(candidate.pitch - idealPitch);
  const ageMatchScore = Math.max(0, 1 - pitchDelta * 2) * 0.7 + Math.random() * 0.3;
  
  // Comfort score based on post-FX profile
  const comfortBase = 0.65;
  const eqBonus = Math.abs(candidate.postFXProfile.eqTilt) < 0.2 ? 0.1 : 0;
  const reverbBonus = candidate.postFXProfile.reverbAmount < 0.25 ? 0.1 : 0;
  const comfortScore = Math.min(1, comfortBase + eqBonus + reverbBonus + Math.random() * 0.15);
  
  // Spectral quality (simulated)
  const spectralQuality = 0.7 + Math.random() * 0.25;
  
  // Calculate overall fitness
  const overall = (
    clarity * 0.3 +
    personaScore * 0.3 +
    ageMatchScore * 0.2 +
    comfortScore * 0.2
  );
  
  return {
    overall,
    clarity,
    personaScore,
    ageMatchScore,
    comfortScore,
    spectralQuality,
    evaluatedAt: new Date(),
  };
}

/**
 * Generate test clips for a candidate
 */
async function generateTestClips(candidate: VoiceCandidate): Promise<TestClipResult[]> {
  const rewriter = new LexaraPersonaRewriter(candidate.stylePrompt, candidate.pausePattern);
  const clips: TestClipResult[] = [];
  
  for (const [type, phrases] of Object.entries(TEST_PHRASES)) {
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    const processed = rewriter.rewrite(phrase);
    
    clips.push({
      type: type as TestClipResult['type'],
      originalText: phrase,
      processedText: processed,
      // In production, these would be actual audio analysis results
      wordErrorRate: Math.random() * 0.1,
      spectralClarity: 0.8 + Math.random() * 0.15,
      personaMatchScore: 0.7 + Math.random() * 0.25,
    });
  }
  
  return clips;
}

// ============================================================================
// LEXARA VOICE FORGE ENGINE
// ============================================================================

export const voiceForgeEvents = new EventEmitter();

class LexaraVoiceForgeEngine {
  private static instance: LexaraVoiceForgeEngine;
  private config: VoiceForgeConfig;
  private state: VoiceForgeState;
  
  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.state = {
      isRunning: false,
      currentGeneration: 0,
      totalEvaluated: 0,
      bestFitness: 0,
      currentElite: [],
      frozenProfiles: [],
      activeProfile: null,
      lastRunAt: null,
    };
  }
  
  static getInstance(): LexaraVoiceForgeEngine {
    if (!LexaraVoiceForgeEngine.instance) {
      LexaraVoiceForgeEngine.instance = new LexaraVoiceForgeEngine();
    }
    return LexaraVoiceForgeEngine.instance;
  }
  
  /**
   * Configure the Voice Forge
   */
  configure(config: Partial<VoiceForgeConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('Voice Forge configured', this.config);
  }
  
  /**
   * Get current state
   */
  getState(): VoiceForgeState {
    return { ...this.state };
  }
  
  /**
   * Get the active frozen profile
   */
  getActiveProfile(): FrozenVoiceProfile | null {
    return this.state.activeProfile;
  }
  
  /**
   * Run the Monte Carlo voice search
   */
  async runVoiceSearch(): Promise<FrozenVoiceProfile | null> {
    if (this.state.isRunning) {
      log.warn('Voice Forge already running');
      return null;
    }
    
    log.info('🎙️ LEXARA VOICE FORGE - Starting Monte Carlo voice search');
    this.state.isRunning = true;
    this.state.currentGeneration = 0;
    this.state.totalEvaluated = 0;
    this.state.bestFitness = 0;
    this.state.currentElite = [];
    this.state.lastRunAt = new Date();
    
    voiceForgeEvents.emit('search-started', { config: this.config });
    
    try {
      // Initialize population with random candidates
      let population: EvaluatedCandidate[] = [];
      
      log.info(`Generating initial population of ${this.config.populationSize} candidates`);
      
      // Generate and evaluate initial population
      for (let i = 0; i < this.config.populationSize; i++) {
        const candidate = generateRandomCandidate(0, this.config);
        const testClips = await generateTestClips(candidate);
        const fitness = await scoreCandidate(candidate, testClips);
        
        population.push({
          candidate,
          fitness,
          testClips,
          rank: 0,
        });
        
        this.state.totalEvaluated++;
      }
      
      // Sort and rank initial population
      population = this.rankPopulation(population);
      this.state.currentElite = population.slice(0, this.config.eliteCount);
      this.state.bestFitness = population[0].fitness.overall;
      
      log.info(`Initial population best fitness: ${this.state.bestFitness.toFixed(4)}`);
      
      voiceForgeEvents.emit('generation-complete', {
        generation: 0,
        bestFitness: this.state.bestFitness,
        elite: this.state.currentElite,
      });
      
      // Evolution loop
      for (let gen = 1; gen <= this.config.maxGenerations; gen++) {
        this.state.currentGeneration = gen;
        
        log.info(`\n=== Generation ${gen}/${this.config.maxGenerations} ===`);
        
        // Check for early freeze condition
        if (this.state.bestFitness >= this.config.earlyFreezeThreshold) {
          log.info(`🔥 Early freeze triggered! Fitness ${this.state.bestFitness.toFixed(4)} >= ${this.config.earlyFreezeThreshold}`);
          break;
        }
        
        // Generate new population
        const newPopulation: EvaluatedCandidate[] = [];
        
        // Keep elite (unchanged)
        for (const elite of this.state.currentElite) {
          newPopulation.push(elite);
        }
        
        // Generate mutated offspring from elite
        const offspringCount = this.config.populationSize - this.config.eliteCount - this.config.freshInjectionCount;
        for (let i = 0; i < offspringCount; i++) {
          const parentIdx = i % this.state.currentElite.length;
          const parent = this.state.currentElite[parentIdx].candidate;
          const offspring = mutateCandidate(parent, gen, this.config);
          const testClips = await generateTestClips(offspring);
          const fitness = await scoreCandidate(offspring, testClips);
          
          newPopulation.push({
            candidate: offspring,
            fitness,
            testClips,
            rank: 0,
          });
          
          this.state.totalEvaluated++;
        }
        
        // Inject fresh random candidates
        for (let i = 0; i < this.config.freshInjectionCount; i++) {
          const fresh = generateRandomCandidate(gen, this.config);
          const testClips = await generateTestClips(fresh);
          const fitness = await scoreCandidate(fresh, testClips);
          
          newPopulation.push({
            candidate: fresh,
            fitness,
            testClips,
            rank: 0,
          });
          
          this.state.totalEvaluated++;
        }
        
        // Sort and rank new population
        population = this.rankPopulation(newPopulation);
        this.state.currentElite = population.slice(0, this.config.eliteCount);
        
        const prevBest = this.state.bestFitness;
        this.state.bestFitness = population[0].fitness.overall;
        
        const improvement = this.state.bestFitness - prevBest;
        log.info(`Generation ${gen} best: ${this.state.bestFitness.toFixed(4)} (${improvement >= 0 ? '+' : ''}${improvement.toFixed(4)})`);
        
        voiceForgeEvents.emit('generation-complete', {
          generation: gen,
          bestFitness: this.state.bestFitness,
          improvement,
          elite: this.state.currentElite,
        });
        
        // Check for convergence
        if (improvement < this.config.convergenceThreshold && gen > 3) {
          log.info(`Convergence detected (improvement ${improvement.toFixed(6)} < ${this.config.convergenceThreshold})`);
          break;
        }
      }
      
      // Freeze the best candidate
      const winner = this.state.currentElite[0];
      const frozenProfile = this.freezeProfile(winner);
      
      this.state.isRunning = false;
      
      voiceForgeEvents.emit('search-complete', {
        frozenProfile,
        totalEvaluated: this.state.totalEvaluated,
        generations: this.state.currentGeneration,
      });
      
      log.info(`\n🏆 VOICE FORGE COMPLETE`);
      log.info(`   Winner: ${frozenProfile.version}`);
      log.info(`   Fitness: ${frozenProfile.fitness.overall.toFixed(4)}`);
      log.info(`   Engine: ${frozenProfile.candidate.engine}`);
      log.info(`   Voice: ${frozenProfile.candidate.voiceId}`);
      log.info(`   Pitch: ${frozenProfile.candidate.pitch.toFixed(3)}`);
      log.info(`   Rate: ${frozenProfile.candidate.rate.toFixed(3)}`);
      log.info(`   Total Evaluated: ${this.state.totalEvaluated}`);
      
      return frozenProfile;
      
    } catch (error) {
      log.error('Voice Forge error:', error);
      this.state.isRunning = false;
      voiceForgeEvents.emit('search-error', { error });
      throw error;
    }
  }
  
  /**
   * Rank population by fitness
   */
  private rankPopulation(population: EvaluatedCandidate[]): EvaluatedCandidate[] {
    const sorted = [...population].sort((a, b) => b.fitness.overall - a.fitness.overall);
    return sorted.map((item, index) => ({ ...item, rank: index + 1 }));
  }
  
  /**
   * Freeze a winning candidate as an immutable profile
   */
  private freezeProfile(winner: EvaluatedCandidate): FrozenVoiceProfile {
    const version = `LexaraVoiceProfile_v${this.state.frozenProfiles.length + 1}`;
    
    const frozenProfile: FrozenVoiceProfile = {
      version,
      candidate: winner.candidate,
      fitness: winner.fitness,
      frozenAt: new Date(),
      generation: this.state.currentGeneration,
      totalEvaluated: this.state.totalEvaluated,
      isActive: true,
      notes: `Monte Carlo optimized. Best of ${this.state.totalEvaluated} candidates over ${this.state.currentGeneration} generations.`,
    };
    
    // Deactivate previous active profile
    for (const profile of this.state.frozenProfiles) {
      profile.isActive = false;
    }
    
    this.state.frozenProfiles.push(frozenProfile);
    this.state.activeProfile = frozenProfile;
    
    voiceForgeEvents.emit('profile-frozen', { profile: frozenProfile });
    
    return frozenProfile;
  }
  
  /**
   * Manually set active profile by version
   */
  setActiveProfile(version: string): boolean {
    const profile = this.state.frozenProfiles.find(p => p.version === version);
    if (!profile) {
      log.warn(`Profile ${version} not found`);
      return false;
    }
    
    for (const p of this.state.frozenProfiles) {
      p.isActive = false;
    }
    
    profile.isActive = true;
    this.state.activeProfile = profile;
    
    log.info(`Activated profile: ${version}`);
    voiceForgeEvents.emit('profile-activated', { profile });
    
    return true;
  }
  
  /**
   * Get all frozen profiles
   */
  getFrozenProfiles(): FrozenVoiceProfile[] {
    return [...this.state.frozenProfiles];
  }
  
  /**
   * Get the Lexara Persona Rewriter for the active profile
   */
  getPersonaRewriter(): LexaraPersonaRewriter | null {
    if (!this.state.activeProfile) {
      return null;
    }
    
    return new LexaraPersonaRewriter(
      this.state.activeProfile.candidate.stylePrompt,
      this.state.activeProfile.candidate.pausePattern
    );
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const lexaraVoiceForge = LexaraVoiceForgeEngine.getInstance();

export async function runVoiceForgeSearch(): Promise<FrozenVoiceProfile | null> {
  return lexaraVoiceForge.runVoiceSearch();
}

export function configureVoiceForge(config: Partial<VoiceForgeConfig>): void {
  lexaraVoiceForge.configure(config);
}

export function getVoiceForgeState(): VoiceForgeState {
  return lexaraVoiceForge.getState();
}

export function getActiveVoiceProfile(): FrozenVoiceProfile | null {
  return lexaraVoiceForge.getActiveProfile();
}

export function getVoiceForgeRewriter(): LexaraPersonaRewriter | null {
  return lexaraVoiceForge.getPersonaRewriter();
}

export default lexaraVoiceForge;
