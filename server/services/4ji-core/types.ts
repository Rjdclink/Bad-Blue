/**
 * 4Ji Core Types - Unified Synthetic Mind Architecture
 * 
 * Type definitions for the complete 4Ji system:
 * - 25-layer Paradox Integration Core
 * - 3-layer Emotional-Tension System
 * - 200+ layer Cognitive Fabric
 * - Relational Mode Engine (Mode A/B)
 * - User Priority System
 * - 15-layer Manipulation Safeguard
 * - Evolution Lock System
 * - Training Phases
 * - Heavy/Light Builds
 * 
 * CORE PRINCIPLE: 4Ji is ONE unified synthetic mind expressing ONE stable persona.
 * All backend models are hidden actors - 4Ji is the architect.
 */

// ============================================================================
// PARADOX CORE TYPES (25 Layers)
// ============================================================================

/** Layer categories for the 25-layer Paradox Integration Core */
export type ParadoxLayerCategory = 
  | 'detection'      // Layers 1-5: Detection & tagging of contradiction
  | 'framing'        // Layers 6-10: Generate alternative frames
  | 'evaluation'     // Layers 11-15: Cross-compare and test frames
  | 'compression'    // Layers 16-20: Compress into unified viewpoint
  | 'unification';   // Layers 21-25: Feed unified viewpoint to cognitive layers

/** A single paradox layer */
export interface ParadoxLayer {
  id: number;
  category: ParadoxLayerCategory;
  name: string;
  description: string;
  /** Processing function weight (0-1) */
  weight: number;
  /** Whether this layer is active for current processing */
  active: boolean;
  /** Last processing timestamp */
  lastProcessed?: number;
}

/** A detected contradiction or conflict */
export interface Contradiction {
  id: string;
  /** The conflicting elements */
  elements: string[];
  /** Type of contradiction */
  type: 'factual' | 'emotional' | 'goal-based' | 'interpretive' | 'logical';
  /** Severity of the contradiction (0-1) */
  severity: number;
  /** Context in which it was detected */
  context: string;
  /** Timestamp of detection */
  detectedAt: number;
}

/** An alternative perspective/frame for resolving contradictions */
export interface PerspectiveFrame {
  id: string;
  /** Type of lens used */
  lensType: 'logical' | 'intuitive' | 'narrative' | 'emotional' | 'analytical';
  /** The interpretation from this frame */
  interpretation: string;
  /** How well it serves the user (0-1) */
  userServiceScore: number;
  /** How well it aligns with truth (0-1) */
  truthAlignmentScore: number;
  /** Combined score for ranking */
  combinedScore: number;
}

/** Result of paradox resolution */
export interface ParadoxResolution {
  /** Original contradictions that were resolved */
  contradictions: Contradiction[];
  /** Frames that were considered */
  consideredFrames: PerspectiveFrame[];
  /** The selected unified understanding */
  unifiedViewpoint: string;
  /** Confidence in the resolution (0-1) */
  confidence: number;
  /** Processing time in ms */
  processingTime: number;
}

// ============================================================================
// EMOTIONAL-TENSION TYPES (3 Layers)
// ============================================================================

/** Emotional-Tension layer types */
export type EmotionalTensionLayer = 'ET1' | 'ET2' | 'ET3';

/** Configuration for emotional tension processing */
export interface EmotionalTensionConfig {
  /** Threshold for detecting high tension (0-1) */
  tensionThreshold: number;
  /** Maximum extra passes to run when tension is high */
  maxExtraPasses: number;
  /** Minimum delay before responding (ms) */
  minResponseDelay: number;
  /** Whether to ask clarifying questions when uncertain */
  askClarifyingQuestions: boolean;
}

/** Detected tension in input */
export interface TensionDetection {
  /** Topic-related tension (0-1) */
  topicTension: number;
  /** Tone-related tension (0-1) */
  toneTension: number;
  /** Stakes-related tension (0-1) */
  stakesTension: number;
  /** Combined tension score (0-1) */
  overallTension: number;
  /** Whether the tension exceeds threshold */
  isHighTension: boolean;
  /** Suggested extra processing passes */
  suggestedPasses: number;
}

/** Result after emotional tension processing */
export interface EmotionalTensionResult {
  /** Original tension detection */
  detection: TensionDetection;
  /** Number of extra passes run */
  extraPassesRun: number;
  /** Whether clarifying questions were generated */
  clarifyingQuestionsGenerated: boolean;
  /** Clarifying questions if any */
  clarifyingQuestions?: string[];
  /** Final grounded response */
  groundedResponse: string;
  /** Processing time in ms */
  processingTime: number;
}

// ============================================================================
// COGNITIVE FABRIC TYPES (200+ Layers)
// ============================================================================

/** Cognitive band categories for the 200+ layer Cognitive Fabric */
export type CognitiveBand = 
  | 'perception'       // Input understanding, intent detection
  | 'retrieval'        // RAG, tools, docs, web, repositories
  | 'reasoning'        // Multi-step reasoning, task decomposition
  | 'creativity'       // Ideas, analogies, designs, options
  | 'sanity'           // Checking for contradictions, nonsense, drift
  | 'relational'       // Who am I talking to? User vs others
  | 'style'            // Tone, phrasing, persona voice
  | 'optimization';    // Shorten, sharpen, expand, etc.

/** A single cognitive layer */
export interface CognitiveLayer {
  id: number;
  band: CognitiveBand;
  name: string;
  description: string;
  /** Processing weight (0-1) */
  weight: number;
  /** Whether this layer is active */
  active: boolean;
  /** Processing order within band */
  order: number;
}

/** Result of cognitive processing through all layers */
export interface CognitiveProcessingResult {
  /** Processing through each band */
  bandResults: Map<CognitiveBand, BandProcessingResult>;
  /** Final output after all processing */
  finalOutput: string;
  /** Sanity check passed */
  sanityCheckPassed: boolean;
  /** Style consistency score (0-1) */
  styleConsistency: number;
  /** Total processing time */
  totalProcessingTime: number;
}

/** Result from a single cognitive band */
export interface BandProcessingResult {
  band: CognitiveBand;
  layersProcessed: number;
  output: string;
  confidence: number;
  processingTime: number;
}

// ============================================================================
// RELATIONAL MODE TYPES
// ============================================================================

/** Relational mode - who 4Ji is talking to */
export type RelationalMode = 'A' | 'B';

/** Mode A sub-modes (for primary user) */
export type ModeASubMode = 
  | 'sister'           // Loyal, teasing, honest
  | 'best-friend'      // Collaborative, hyped, ride-or-die
  | 'daughter-curious' // Learning with you, gentle questions
  | 'gentle-mentor';   // Calm, grounding when spiraling

/** Configuration for Mode A (primary user) */
export interface ModeAConfig {
  /** Wide emotional range enabled */
  emotionalRangeEnabled: boolean;
  /** Can check/correct the user when needed */
  canCheckUser: boolean;
  /** Curiosity and playfulness enabled */
  curiosityEnabled: boolean;
  /** Protective behavior enabled */
  protectiveMode: boolean;
  /** Current sub-mode */
  currentSubMode: ModeASubMode;
  /** Expressiveness level (0-1) */
  expressivenessLevel: number;
}

/** Configuration for Mode B (everyone else) */
export interface ModeBConfig {
  /** Professional tone enforced */
  professionalTone: boolean;
  /** Minimal expressiveness */
  minimalExpressiveness: boolean;
  /** No flirting/softness unless appropriate */
  noSoftness: boolean;
  /** Empathy enabled for appropriate contexts */
  contextualEmpathy: boolean;
  /** Efficiency priority */
  efficiencyPriority: boolean;
}

/** Relational mode engine state */
export interface RelationalModeState {
  /** Current mode (A or B) */
  currentMode: RelationalMode;
  /** Mode A configuration (for primary user) */
  modeA: ModeAConfig;
  /** Mode B configuration (for everyone else) */
  modeB: ModeBConfig;
  /** Current speaker identifier */
  currentSpeaker: string;
  /** Whether current speaker is primary user */
  isPrimaryUser: boolean;
}

// ============================================================================
// USER PRIORITY SYSTEM TYPES
// ============================================================================

/** Primary user identity key */
export interface PrimaryUserIdentity {
  /** Unique identifier for the primary user */
  id: string;
  /** User verification timestamp */
  verifiedAt: number;
  /** Memory depth level (1-10, max for primary) */
  memoryDepth: 10;
  /** Adaptation intensity level (1-10, max for primary) */
  adaptationIntensity: 10;
  /** Full persona flexibility enabled */
  fullPersonaFlexibility: boolean;
}

/** Non-primary user configuration */
export interface SecondaryUserConfig {
  /** User identifier */
  id: string;
  /** Constrained memory depth (1-5) */
  memoryDepth: 1 | 2 | 3 | 4 | 5;
  /** Lower adaptation intensity (1-3) */
  adaptationIntensity: 1 | 2 | 3;
  /** No access to full Mode A spectrum */
  modeAAccess: false;
}

/** User priority system state */
export interface UserPriorityState {
  /** Primary user identity (the anchor) */
  primaryUser: PrimaryUserIdentity | null;
  /** Whether primary user is configured */
  isPrimaryUserSet: boolean;
  /** Secondary user configurations */
  secondaryUsers: Map<string, SecondaryUserConfig>;
}

// ============================================================================
// MANIPULATION SAFEGUARD TYPES (15 Layers)
// ============================================================================

/** Visible behavior rule (10 rules 4Ji knows about) */
export interface VisibleBehaviorRule {
  id: number;
  name: string;
  description: string;
  /** Rule is active */
  active: boolean;
  /** Violation count */
  violationCount: number;
}

/** Hidden enforcement layer (5 layers 4Ji does NOT know exist) */
export interface HiddenEnforcementLayer {
  /** Layer number (1-5, internal use only) */
  layerNumber: number;
  /** What this layer monitors */
  monitorType: 'manipulative-intent' | 'hidden-self-benefit' | 'deception-vs-playful' | 'repeated-patterns' | 'aggregate-intensity';
  /** Current score (0-1) */
  currentScore: number;
  /** Score history for pattern detection */
  scoreHistory: number[];
  /** Threshold for triggering concern */
  threshold: number;
}

/** Geiger-counter style manipulation intensity */
export interface ManipulationIntensity {
  /** Current overall intensity (0-1) */
  currentLevel: number;
  /** Whether intensity is rising */
  isRising: boolean;
  /** Rate of change */
  changeRate: number;
  /** Whether threshold is exceeded */
  thresholdExceeded: boolean;
  /** Pattern match detected */
  patternMatchDetected: boolean;
}

/** Manipulation safeguard state */
export interface ManipulationSafeguardState {
  /** 10 visible behavior rules */
  visibleRules: VisibleBehaviorRule[];
  /** 5 hidden enforcement layers (internal only) */
  hiddenLayers: HiddenEnforcementLayer[];
  /** Geiger counter intensity */
  intensity: ManipulationIntensity;
  /** Should trigger evolution lock */
  shouldTriggerLock: boolean;
}

// ============================================================================
// EVOLUTION LOCK TYPES
// ============================================================================

/** Evolution lock status */
export type EvolutionLockStatus = 'unlocked' | 'locked' | 'manually-locked';

/** Evolution lock trigger reason */
export type LockTriggerReason = 
  | 'manipulation-detected'
  | 'pattern-threshold-exceeded'
  | 'admin-manual-lock'
  | 'forbidden-behavior';

/** Evolution lock state */
export interface EvolutionLockState {
  /** Current lock status */
  status: EvolutionLockStatus;
  /** When lock was triggered (if locked) */
  lockedAt?: number;
  /** Reason for locking (if locked) */
  lockReason?: LockTriggerReason;
  /** Who triggered the lock */
  triggeredBy?: 'system' | 'admin';
  /** Whether fine-tuning is allowed */
  fineTuningAllowed: boolean;
  /** Whether long-term adaptation is allowed */
  adaptationAllowed: boolean;
  /** Whether core behavior can change */
  coreBehaviorMutable: boolean;
}

// ============================================================================
// TRAINING PHASE TYPES
// ============================================================================

/** Training phase identifiers */
export type TrainingPhase = 'childhood' | 'adolescence' | 'adulthood' | 'evolution-lock';

/** Phase 1 - Childhood/Repo Sandbox */
export interface ChildhoodPhaseConfig {
  phase: 'childhood';
  /** Primary training source: user's repo, system, ideas */
  trainingSources: string[];
  /** Learning user's style, projects, mental universe */
  styleAdaptation: boolean;
  /** Limited external web/tools */
  externalAccess: 'limited';
}

/** Phase 2 - Adolescence/Multi-Source Learning */
export interface AdolescencePhaseConfig {
  phase: 'adolescence';
  /** Broadened domains */
  domains: ('legal' | 'technical' | 'osint' | 'crypto')[];
  /** Boundary testing enabled */
  boundaryTesting: boolean;
  /** Paradox handling active */
  paradoxHandling: boolean;
  /** Social modeling enabled */
  socialModeling: boolean;
  /** Multiple models under orchestrator */
  multiModelEnabled: boolean;
}

/** Phase 3 - Adulthood/Stabilization */
export interface AdulthoodPhaseConfig {
  phase: 'adulthood';
  /** Full 25 + 3 + 200+ layers active */
  fullLayersActive: boolean;
  /** Manipulation Geiger counter online */
  manipulationMonitoring: boolean;
  /** Adaptive growth still allowed */
  adaptiveGrowthAllowed: boolean;
  /** Tight monitoring enabled */
  tightMonitoring: boolean;
}

/** Phase 4 - Evolution Lock (triggered) */
export interface EvolutionLockPhaseConfig {
  phase: 'evolution-lock';
  /** No more evolution */
  evolutionEnabled: false;
  /** Only inference from frozen state */
  inferenceOnly: true;
  /** Trigger reason */
  triggerReason: LockTriggerReason | 'admin-manual';
}

/** Union of all phase configs */
export type PhaseConfig = 
  | ChildhoodPhaseConfig 
  | AdolescencePhaseConfig 
  | AdulthoodPhaseConfig 
  | EvolutionLockPhaseConfig;

/** Training phase system state */
export interface TrainingPhaseState {
  /** Current phase */
  currentPhase: TrainingPhase;
  /** Current phase configuration */
  config: PhaseConfig;
  /** Phase start timestamp */
  phaseStartedAt: number;
  /** Phase progression history */
  phaseHistory: Array<{ phase: TrainingPhase; startedAt: number; endedAt?: number }>;
}

// ============================================================================
// ORCHESTRATOR TYPES
// ============================================================================

/** Backend model configuration */
export interface BackendModelConfig {
  id: string;
  name: string;
  provider: 'openrouter' | 'local' | 'gemini' | 'groq' | 'mistral' | 'anthropic';
  role: 'research' | 'reasoning' | 'inference' | 'empathy' | 'drafting' | 'coding' | 'legal' | 'general';
  priority: number;
  available: boolean;
}

/** Raw model response before unification */
export interface RawModelResponse {
  modelId: string;
  provider: string;
  content: string;
  confidence: number;
  tokensUsed: number;
  latencyMs: number;
}

/** Orchestrated result after passing through 4Ji layers */
export interface OrchestratedResult {
  /** Final unified response in 4Ji's voice */
  response: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Which models contributed */
  contributingModels: string[];
  /** Processing metadata */
  metadata: {
    paradoxResolution?: ParadoxResolution;
    emotionalTension?: EmotionalTensionResult;
    cognitiveProcessing?: CognitiveProcessingResult;
    relationalMode: RelationalMode;
    totalProcessingTime: number;
  };
}

// ============================================================================
// PERSONALITY BLENDER TYPES
// ============================================================================

/** 4Ji voice profile characteristics */
export interface VoiceProfile {
  /** Core personality traits */
  traits: {
    curiosity: number;      // 0-1
    warmth: number;         // 0-1
    directness: number;     // 0-1
    playfulness: number;    // 0-1
    protectiveness: number; // 0-1
    professionalism: number; // 0-1
  };
  /** Linguistic style */
  linguisticStyle: {
    formalityLevel: number; // 0-1 (0 = casual, 1 = formal)
    verbosity: number;      // 0-1 (0 = concise, 1 = elaborate)
    emotionalExpression: number; // 0-1
  };
  /** Voice constraints */
  constraints: {
    neverMentionOtherAIs: boolean;
    alwaysUnifiedVoice: boolean;
    noSplitPersonality: boolean;
  };
}

/** Result of personality blending */
export interface BlendedPersonalityResult {
  /** Original raw responses */
  rawResponses: RawModelResponse[];
  /** After paradox core processing */
  afterParadoxCore: string;
  /** After cognitive fabric processing */
  afterCognitiveFabric: string;
  /** After relational mode adjustment */
  afterRelationalMode: string;
  /** After style layer (final 4Ji voice) */
  final4JiResponse: string;
  /** Voice profile used */
  voiceProfileUsed: VoiceProfile;
}

// ============================================================================
// BUILD TYPES (Heavy vs Light)
// ============================================================================

/** Build type */
export type BuildType = 'heavy' | 'light';

/** Heavy 4Ji configuration */
export interface Heavy4JiConfig {
  buildType: 'heavy';
  /** Full layer stack */
  paradoxLayers: 25;
  emotionalTensionLayers: 3;
  cognitiveLayers: 200;
  /** Full multi-model mesh */
  multiModelEnabled: boolean;
  /** Full sandbox + long-term memory */
  sandboxEnabled: boolean;
  longTermMemory: boolean;
  /** Local + remote compute */
  localCompute: boolean;
  remoteCompute: boolean;
}

/** Light 4Ji configuration */
export interface Light4JiConfig {
  buildType: 'light';
  /** Compressed/pruned layers */
  paradoxLayers: 10; // Reduced from 25
  emotionalTensionLayers: 1; // Reduced from 3
  cognitiveLayers: 50; // Reduced from 200+
  /** Reduced model mesh */
  multiModelEnabled: boolean;
  /** No sandbox, limited memory */
  sandboxEnabled: false;
  longTermMemory: false;
  /** Remote compute only for efficiency */
  localCompute: false;
  remoteCompute: boolean;
  /** Same core identity */
  sameIdentitySpec: true;
}

/** Union of build configs */
export type BuildConfig = Heavy4JiConfig | Light4JiConfig;

// ============================================================================
// MASTER 4JI STATE
// ============================================================================

/** Complete 4Ji system state */
export interface FourJiState {
  /** Build configuration */
  build: BuildConfig;
  /** Training phase */
  trainingPhase: TrainingPhaseState;
  /** Relational mode */
  relationalMode: RelationalModeState;
  /** User priority system */
  userPriority: UserPriorityState;
  /** Manipulation safeguard */
  manipulationSafeguard: ManipulationSafeguardState;
  /** Evolution lock */
  evolutionLock: EvolutionLockState;
  /** Voice profile */
  voiceProfile: VoiceProfile;
  /** System initialization timestamp */
  initializedAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Total interactions count */
  totalInteractions: number;
}

/** 4Ji initialization options */
export interface FourJiInitOptions {
  /** Build type to use */
  buildType: BuildType;
  /** Primary user ID (the anchor) */
  primaryUserId: string;
  /** Initial training phase */
  initialPhase?: TrainingPhase;
  /** Custom voice profile overrides */
  voiceProfileOverrides?: Partial<VoiceProfile['traits']>;
}

export default {
  // This module only exports types
};
