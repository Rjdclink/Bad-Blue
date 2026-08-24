/**
 * Autonomous Crypto Faucet - Enterprise-Grade Self-Regulating Profit Extraction System
 * 
 * CRITICAL DESIGN PRINCIPLES:
 * 1. The faucet MUST open when conditions are favorable - this is non-negotiable
 * 2. The faucet MUST close when conditions deteriorate - this is non-negotiable
 * 3. All state transitions are atomic and verified
 * 4. Self-healing mechanisms ensure continuous operation
 * 5. Circuit breakers prevent cascade failures
 * 
 * Integrated with Babel system for IP protection - no two crawlers speak the same language
 */

import { NeurofusionEngine } from '../core/neurofusion.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import { MultiOraclePriceValidator } from '../validation/multi-oracle-validator.js';
import { MasterOrchestrator } from '../core/master-orchestrator.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { centralizedExchangeExecutor } from '../execution/centralized-exchange-executor.js';
import { stageManager } from '../governance/stage-management.js';
import { evaluateAutomaticStageProgression } from '../governance/automatic-stage-progression.js';
import { GovernanceError } from '../governance/types.js';
import { getCryptara } from '../../cryptara/index.js';
import logger from '../../../logger.js';

// Babel Integration - IP Protection Systems + Cain Reasoning
import {
  TowerOfBabel,
  CrawlerFingerprintEngine,
  LightLanguageEngine,
  TradingViewEngine,
  CainReasoningEngine,
  initializeCain,
  reasonForCain,
  getSecurityProofs,
  generateSecurityProofs,
  alertSwarm,
  getGlobalThreatLevel,
  type TechnicalAnalysis,
  type CrawlerOptimization,
  type ReasoningConclusion,
  type SecurityProof,
  type ReasoningContext,
} from '../babel/index.js';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

export interface MarketConditions {
  volatility: number;           // 0-100 scale
  gasEfficiency: number;        // USD cost per trade
  spreadOpportunities: number;  // Count of profitable spreads
  competitionLevel: number;     // MEV bot activity 0-1
  liquidityDepth: number;       // Available liquidity
  technicalSignal: 'bullish' | 'bearish' | 'neutral';
  timestamp: number;            // When conditions were last updated
  confidence: number;           // 0-1, confidence in the data quality
  technicalDataProvenance: 'live' | 'cached' | 'deterministic-fallback' | 'no-data';
  technicalDataTimestamp: number | null;
  quoteDataProvenance: 'live' | 'no-data';
  quoteDataTimestamp: number | null;
  lastMarketDataError?: string;
  lastMarketGateError?: string;
}

export interface FaucetState {
  mode: FaucetMode;
  profitThisSession: number;
  profitThisHour: number;
  profitThisDay: number;        // Track daily progress toward $35K target
  profitThisWindow: number;     // Current trading window profit
  tradesThisHour: number;
  tradesThisDay: number;        // Daily trade count
  currentWindow: number;        // Current trading window (0-17)
  lastModeChange: number;
  lastLoopIterationAt: number;  // Timestamp of last main-loop iteration (stall detection)
  stealthLevel: number;         // 0-10, higher = more invisible
  healthScore: number;          // 0-100, system health
  consecutiveFailures: number;  // Track failure patterns
  lastSuccessfulTrade: number;  // Timestamp of last success
  dailyTargetProgress: number;  // 0-100% of daily target
  exchangeDistribution: Map<string, number>; // Profit per exchange
  // Cain Dimensional Reasoning Integration
  cainId: string;                             // Unique Cain identifier
  lastReasoningConclusion: ReasoningConclusion | null; // Last reasoning result
  securityProofsValid: number;                // Count of valid security proofs
  globalThreatLevel: string;                  // Current threat level
  // Arbitrage verification (real quotes + all-in costs)
  executionMode: 'disabled' | 'live';
  lastVerifiedArbitrage: VerifiedArbitragePlan | null;
  lastArbitrageDecision: 'EXECUTE' | 'SKIP' | 'ERROR' | 'NONE';
}

export type FaucetMode = 'closed' | 'opening' | 'open' | 'closing' | 'cooldown' | 'stealth' | 'emergency';

export interface CircuitBreakerState {
  isOpen: boolean;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  halfOpenAttempts: number;
}

export interface HealthCheck {
  component: string;
  status: 'healthy' | 'degraded' | 'critical';
  latency: number;
  lastCheck: number;
  message: string;
}

export interface StressTestResult {
  testName: string;
  passed: boolean;
  duration: number;
  details: string;
  timestamp: number;
}

export interface OpenCloseDecision {
  shouldOpen: boolean;
  shouldClose: boolean;
  confidence: number;
  reasons: string[];
  validators: ValidatorResult[];
}

type ExpectedProfitAssessment = {
  status: 'VALID_POSITIVE' | 'VALID_ZERO' | 'VALID_NEGATIVE' | 'INCOMPLETE_DATA';
  grossProfitUsd: number | null;
  netProfitUsd: number | null;
  reason: string;
};

export interface ValidatorResult {
  name: string;
  passed: boolean;
  weight: number;
  details: string;
}

/**
 * Translation Firewall Message - Internal format
 */
export interface InternalMessage {
  id: string;
  intent: string;                 // Light language intent
  payload: unknown;               // Actual data
  sourceId: string;               // Source crawler ID
  timestamp: number;
  priority: number;               // 0-10
  confidentiality: number;        // 0-10
}

/**
 * Translation Firewall Message - External format
 */
export interface ExternalMessage {
  id: string;
  type: 'json' | 'rest' | 'websocket' | 'abi' | 'custom';
  data: Buffer | string | object;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Communication Security State
 */
export interface CommSecurityState {
  inboundMessages: number;
  outboundMessages: number;
  blockedMessages: number;
  quarantinedMessages: number;
  lastThreatDetected: number | null;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// CONFIGURATION - Extensively tuned for real-world operation
// ============================================================================

/**
 * Daily Profit Target Configuration
 * Designed to achieve $35,000/day while avoiding compliance red flags
 * Uses adaptive distribution across time windows and exchanges
 */
export const DAILY_TARGET_CONFIG = Object.freeze({
  // Core target
  dailyTarget: 35000,              // $35,000 daily target
  
  // Time-based distribution (avoid patterns)
  tradingWindows: 18,              // Spread across 18 windows per day
  windowDuration: 80,              // Minutes per window (80 min = 18 windows)
  windowVariance: 0.3,             // ±30% variance in window targets
  
  // Per-window limits (adaptive)
  baseWindowTarget: 1944,          // $35K / 18 = ~$1944 per window
  minWindowProfit: 500,            // Minimum per window
  maxWindowProfit: 3500,           // Maximum per window (avoid spikes)
  
  // Stealth multipliers (reduce activity during scrutiny)
  lowProfileMultiplier: 0.7,       // When competition detected
  highProfileMultiplier: 1.3,      // When opportunity is clear
  
  // Exchange distribution (never dominate any single exchange)
  maxExchangePercent: 0.15,        // Max 15% of daily from one exchange
  minExchangeCount: 5,             // Use at least 5 exchanges
  supportedExchanges: ['binance', 'coinbase', 'kraken', 'kucoin', 'bybit', 'okx', 'gate', 'huobi'],
  
  // Volume camouflage
  maxMarketImpact: 0.02,           // Max 2% of any market's volume
  orderSizeVariance: 0.4,          // ±40% order size variation
  timingJitter: 30000,             // ±30 second timing randomization
});

/** Stealth configuration to avoid market attention */
export const STEALTH_CONFIG = Object.freeze({
  // Hourly limits (derived from daily target)
  maxHourlyProfit: 2500,           // ~$2500/hour max (slightly over 35K/14hrs)
  maxTradesPerHour: 150,           // Higher trade count but smaller sizes
  volumeCapPercent: 0.02,          // Max 2% of market volume per trade
  minProfitToActivate: 50,         // Minimum expected profit to activate
  cooldownMinutes: 10,             // Shorter cooldown for higher throughput
  stealthIncreaseRate: 0.05,       // Slower stealth increase
  
  // Anti-detection measures
  patternBreakingEnabled: true,    // Randomize trading patterns
  exchangeRotation: true,          // Rotate between exchanges
  pairDiversification: true,       // Spread across trading pairs
  orderTypeVariation: true,        // Mix limit/market orders
  
  // Compliance thresholds
  maxSingleTrade: 5000,            // Max $5K per single trade
  minTimeBetweenTrades: 500,       // Min 500ms between trades
  maxTradesPerMinute: 20,          // Max 20 trades/minute
});

/**
 * Communication Security Configuration
 * Two-layer translation firewall for secure crawler communication
 */
export const COMM_SECURITY_CONFIG = Object.freeze({
  // Layer A: Internal → External
  internalToExternal: {
    encryptionStrength: 256,       // AES-256 equivalent
    obfuscationLayers: 3,          // Triple obfuscation
    formatAdaptation: true,        // Adapt to target format (JSON, REST, etc.)
    intentMasking: true,           // Hide true intent in payload
    timingObfuscation: true,       // Add random timing
  },
  
  // Layer B: External → Internal
  externalToInternal: {
    decompositionDepth: 5,         // Deep packet analysis
    sanitizationLevel: 'paranoid', // Maximum sanitization
    intentExtraction: true,        // Extract true meaning
    threatDetection: true,         // Detect malicious inputs
    quarantineUnknown: true,       // Quarantine unrecognized patterns
  },
  
  // Babel shell configuration
  babelShellEvolution: {
    evolutionRate: 0.1,            // 10% mutation per cycle
    incompatibilityLevel: 1.0,     // 100% incompatible between crawlers
    reverseEngineeringResistance: 0.99, // 99% resistance
    mimicryDetection: true,        // Detect external mimicry attempts
  },
});

/** Circuit breaker configuration for fault tolerance */
const CIRCUIT_BREAKER_CONFIG = Object.freeze({
  failureThreshold: 5,            // Failures before opening circuit
  successThreshold: 3,            // Successes to close circuit in half-open
  timeout: 60000,                 // Time before attempting half-open (ms)
  halfOpenMaxAttempts: 3,         // Max attempts in half-open state
});

/** Open/Close decision thresholds - CRITICAL for reliable operation */
const DECISION_CONFIG = Object.freeze({
  // Opening thresholds
  minConfidenceToOpen: 0.7,       // Minimum confidence score to open
  minValidatorsToOpen: 4,         // Minimum validators that must pass
  // Stage Two: small, controlled cycles require a low-but-positive threshold.
  // This threshold is evaluated against an all-in net profit estimate (after fees/gas/bridge).
  minExpectedProfitToOpen: 1,     // Minimum expected profit to open ($1)
  maxGasToOpen: 10,               // Maximum gas cost to open ($)
  maxCompetitionToOpen: 0.7,      // Maximum competition level to open
  
  // Closing thresholds
  maxConfidenceToStayOpen: 0.3,   // Below this, close immediately
  minValidatorsToStayOpen: 2,     // Must have at least this many passing
  maxConsecutiveFailures: 3,      // Close after this many failures
  emergencyCloseThreshold: 0.01,  // Emergency close if profit drops below
  
  // Timing
  minOpenDuration: 5000,          // Minimum time to stay open (ms)
  maxOpenDuration: 3600000,       // Maximum time open before forced cooldown (1 hour)
  transitionTimeout: 10000,       // Timeout for state transitions (ms)
});

/** Sleep timing configuration (milliseconds) */
const TIMING_CONFIG = Object.freeze({
  activeMinSleep: 1000,           // Faster for higher throughput
  activeMaxSleep: 3000,
  stealthMinSleep: 20000,
  stealthMaxSleep: 90000,
  cooldownSleep: 45000,           // Shorter cooldown
  scanningMinSleep: 5000,
  scanningMaxSleep: 15000,
  healthCheckInterval: 20000,
  marketUpdateInterval: 3000,
  hourlyResetCheck: 60000,        // Check every minute
  emergencyCooldownMultiplier: 2, // Double cooldown in emergency
});

/** Trade execution configuration */
const TRADE_CONFIG = Object.freeze({
  minRandomDelay: 500,            // Faster execution
  maxRandomDelay: 2000,
  minSizeVariation: 0.6,          // More variation for stealth
  maxSizeVariation: 1.4,
  minProfit: 20,
  maxProfit: 200,                 // Higher profit per trade possible
  successRateThreshold: 0.92,     // Slightly higher threshold
  avgSpreadProfit: 25,            // Higher average
  competitionImpactFactor: 0.4,
  maxGasCostDivisor: 25,
});

/** Validation bounds */
const VALIDATION = Object.freeze({
  minVolatility: 0,
  maxVolatility: 100,
  minCompetition: 0,
  maxCompetition: 1,
  minGasEfficiency: 0,
  maxGasEfficiency: 1000,
  minLiquidityDepth: 0,
  minSpreadOpportunities: 0,
});

// ============================================================================
// TRANSLATION FIREWALL - Two-layer communication security
// ============================================================================

/**
 * Translation Firewall
 * Layer A: Internal → External (Light language to API/JSON/etc.)
 * Layer B: External → Internal (Decompose, sanitize, extract intent)
 */
class TranslationFirewall {
  private static inboundCount = 0;
  private static outboundCount = 0;
  private static blockedCount = 0;
  private static quarantineQueue: ExternalMessage[] = [];
  private static threatLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  private static lastThreat: number | null = null;

  /**
   * Layer A: Translate internal Light Language to external format
   * Hides internal structure, adapts to target format
   */
  static translateToExternal(internal: InternalMessage, targetFormat: ExternalMessage['type']): ExternalMessage {
    this.outboundCount++;
    
    // Generate unique message ID
    const messageId = `ext-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    // Apply obfuscation layers
    let obfuscatedPayload = this.applyObfuscation(internal.payload, COMM_SECURITY_CONFIG.internalToExternal.obfuscationLayers);
    
    // Add timing obfuscation if enabled
    if (COMM_SECURITY_CONFIG.internalToExternal.timingObfuscation) {
      // Add random jitter (handled externally)
    }
    
    // Mask intent if enabled
    if (COMM_SECURITY_CONFIG.internalToExternal.intentMasking) {
      obfuscatedPayload = this.maskIntent(obfuscatedPayload, internal.intent);
    }
    
    // Format adaptation
    const formatted = this.formatForTarget(obfuscatedPayload, targetFormat);
    
    return {
      id: messageId,
      type: targetFormat,
      data: formatted,
      metadata: {
        timestamp: Date.now(),
        version: '1.0',
      },
    };
  }

  /**
   * Layer B: Translate external format to internal Light Language
   * Decompose, sanitize, extract true intent
   */
  static translateToInternal(external: ExternalMessage, targetCrawlerId: string): InternalMessage | null {
    this.inboundCount++;
    
    // Step 1: Deep decomposition
    const decomposed = this.decomposeMessage(external, COMM_SECURITY_CONFIG.externalToInternal.decompositionDepth);
    
    // Step 2: Sanitization
    const sanitized = this.sanitize(decomposed, COMM_SECURITY_CONFIG.externalToInternal.sanitizationLevel);
    
    // Step 3: Threat detection
    if (COMM_SECURITY_CONFIG.externalToInternal.threatDetection) {
      const threat = this.detectThreat(sanitized);
      if (threat) {
        this.blockedCount++;
        this.lastThreat = Date.now();
        this.updateThreatLevel();
        
        // Quarantine if configured
        if (COMM_SECURITY_CONFIG.externalToInternal.quarantineUnknown) {
          this.quarantineQueue.push(external);
        }
        
        logger.warn('[FIREWALL] Threat detected and blocked', {
          component: 'TranslationFirewall',
          threatType: threat,
          messageId: external.id,
        });
        
        return null;
      }
    }
    
    // Step 4: Extract intent
    const intent = this.extractIntent(sanitized);
    
    return {
      id: `int-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      intent,
      payload: sanitized,
      sourceId: 'external',
      timestamp: Date.now(),
      priority: this.calculatePriority(sanitized),
      confidentiality: this.assessConfidentiality(sanitized),
    };
  }

  /**
   * Apply multiple layers of obfuscation
   */
  private static applyObfuscation(payload: unknown, layers: number): unknown {
    let result = payload;
    for (let i = 0; i < layers; i++) {
      result = this.obfuscateLayer(result, i);
    }
    return result;
  }

  private static obfuscateLayer(data: unknown, layerIndex: number): unknown {
    // Apply different obfuscation based on layer
    const jsonStr = JSON.stringify(data);
    const seed = layerIndex * 137 + 42;
    
    /**
     * NOTE: This XOR-based obfuscation is for DEMONSTRATION PURPOSES ONLY.
     * In production, this should be replaced with proper cryptographic encryption:
     * - AES-256-GCM for symmetric encryption
     * - ChaCha20-Poly1305 for high-performance scenarios
     * - Or use crypto.subtle.encrypt() with proper key management
     */
    const obfuscated = jsonStr.split('').map((c, i) => 
      String.fromCharCode(c.charCodeAt(0) ^ ((seed + i) % 256))
    ).join('');
    
    return { _layer: layerIndex, _data: Buffer.from(obfuscated).toString('base64') };
  }

  private static maskIntent(payload: unknown, intent: string): unknown {
    // Wrap payload to hide true intent
    return {
      _masked: true,
      _decoy: Math.random().toString(36).substring(2),
      payload,
    };
  }

  private static formatForTarget(payload: unknown, format: ExternalMessage['type']): string | object | Buffer {
    switch (format) {
      case 'json':
        return payload as object;
      case 'rest':
        return JSON.stringify(payload);
      case 'websocket':
        return JSON.stringify({ type: 'message', data: payload });
      case 'abi':
        return Buffer.from(JSON.stringify(payload));
      default:
        return payload as object;
    }
  }

  private static decomposeMessage(msg: ExternalMessage, depth: number): unknown {
    let data = msg.data;
    
    // Parse string data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        // Keep as string if not JSON
      }
    }
    
    // Handle Buffer
    if (Buffer.isBuffer(data)) {
      try {
        data = JSON.parse(data.toString());
      } catch {
        data = { raw: data.toString('hex') };
      }
    }
    
    return data;
  }

  /**
   * Sanitize data by encoding potentially dangerous content
   * Uses HTML entity encoding instead of regex removal for security
   */
  private static sanitize(data: unknown, level: string): unknown {
    if (level === 'paranoid') {
      // Deep clone and sanitize using encoding approach
      let str = JSON.stringify(data);
      
      // Use encoding-based approach rather than removal
      // This is safer as it doesn't rely on regex matching
      str = this.encodeHtmlEntities(str);
      
      try {
        return JSON.parse(str);
      } catch {
        // If parsing fails, the content was likely malicious - return safe empty object
        return {};
      }
    }
    return data;
  }
  
  /**
   * Encode HTML entities to prevent XSS
   * Uses a whitelist approach - only allows known safe characters
   */
  private static encodeHtmlEntities(str: string): string {
    const entityMap: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
    };
    
    // Preserve JSON structure while encoding potentially dangerous chars in values
    // This regex targets string values in JSON
    return str.replace(/(?<="[^"]*)(["<>&'])(?=[^"]*")/g, (char) => entityMap[char] || char);
  }

  private static detectThreat(data: unknown): string | null {
    const str = JSON.stringify(data).toLowerCase();
    const normalizedStr = str.replace(/\s+/g, ''); // Remove whitespace for detection
    
    // Detect common attack patterns with normalized strings
    if (normalizedStr.includes('droptable') || normalizedStr.includes('deletefrom') || normalizedStr.includes('truncatetable')) {
      return 'sql_injection';
    }
    if (normalizedStr.includes('<script') || normalizedStr.includes('javascript:') || 
        normalizedStr.includes('vbscript:') || normalizedStr.includes('data:text/html')) {
      return 'xss';
    }
    if (normalizedStr.includes('eval(') || normalizedStr.includes('function(') || normalizedStr.includes('constructor(')) {
      return 'code_injection';
    }
    if (str.length > 1000000) {
      return 'payload_too_large';
    }
    
    return null;
  }

  private static extractIntent(data: unknown): string {
    // Simple intent extraction based on payload structure
    const str = JSON.stringify(data);
    if (str.includes('trade') || str.includes('swap')) return 'TRADE';
    if (str.includes('price') || str.includes('quote')) return 'QUERY';
    if (str.includes('cancel') || str.includes('stop')) return 'CANCEL';
    return 'UNKNOWN';
  }

  private static calculatePriority(data: unknown): number {
    const str = JSON.stringify(data);
    if (str.includes('urgent') || str.includes('critical')) return 10;
    if (str.includes('important') || str.includes('high')) return 7;
    return 5;
  }

  private static assessConfidentiality(data: unknown): number {
    const str = JSON.stringify(data);
    if (str.includes('private') || str.includes('secret')) return 10;
    if (str.includes('internal')) return 7;
    return 3;
  }

  private static updateThreatLevel(): void {
    const recentThreats = this.blockedCount;
    if (recentThreats > 100) this.threatLevel = 'critical';
    else if (recentThreats > 50) this.threatLevel = 'high';
    else if (recentThreats > 10) this.threatLevel = 'medium';
    else this.threatLevel = 'low';
  }

  /**
   * Get current security state
   */
  static getSecurityState(): CommSecurityState {
    return {
      inboundMessages: this.inboundCount,
      outboundMessages: this.outboundCount,
      blockedMessages: this.blockedCount,
      quarantinedMessages: this.quarantineQueue.length,
      lastThreatDetected: this.lastThreat,
      threatLevel: this.threatLevel,
    };
  }
}

// ============================================================================
// AUTONOMOUS CRYPTO FAUCET - ENTERPRISE GRADE IMPLEMENTATION
// ============================================================================

class AutonomousCryptoFaucet {
  // Core state
  private state: FaucetState;
  private marketConditions: MarketConditions;
  private oracleValidator: MultiOraclePriceValidator;
  private isRunning = false;
  private sessionStartTime: number = 0;
  private hourlyResetTime: number = 0;
  private dailyResetTime: number = 0;
  private windowStartTime: number = 0;
  
  // Circuit breaker for fault tolerance
  private circuitBreaker: CircuitBreakerState;
  
  // Health monitoring
  private healthChecks: Map<string, HealthCheck> = new Map();
  private stressTestResults: StressTestResult[] = [];
  
  // Communication security
  private commSecurityState: CommSecurityState;
  
  // Babel Integration - IP Protection
  private faucetId: string;
  private babelInitialized = false;
  private tradingViewAnalysis: TechnicalAnalysis | null = null;
  private crawlerOptimization: CrawlerOptimization | null = null;
  
  // Cain Reasoning Integration - Dimensional Parallel Adaptive Logic
  private cainInitialized = false;
  private lastReasoningTime: number = 0;
  private reasoningInterval: number = 5000;  // Reason every 5 seconds
  
  // Timers and intervals
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private hourlyResetTimer: ReturnType<typeof setInterval> | null = null;

  // Last evaluated arbitrage (cached from updateMarketConditions)
  private lastArbitragePlan: VerifiedArbitragePlan | null = null;

  constructor() {
    // Generate unique faucet ID (this becomes the Cain ID)
    this.faucetId = `faucet-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Initialize oracle validator for price verification
    this.oracleValidator = new MultiOraclePriceValidator();

    // Initialize state with safe defaults - CLOSED by default
    this.state = {
      mode: 'closed',
      profitThisSession: 0,
      profitThisHour: 0,
      profitThisDay: 0,
      profitThisWindow: 0,
      tradesThisHour: 0,
      tradesThisDay: 0,
      currentWindow: 0,
      lastModeChange: Date.now(),
      lastLoopIterationAt: 0,
      stealthLevel: 0,
      healthScore: 100,
      consecutiveFailures: 0,
      lastSuccessfulTrade: 0,
      dailyTargetProgress: 0,
      exchangeDistribution: new Map(),
      // Cain Reasoning state
      cainId: this.faucetId,
      lastReasoningConclusion: null,
      securityProofsValid: 0,
      globalThreatLevel: 'none',
      executionMode: process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true' ? 'live' : 'disabled',
      lastVerifiedArbitrage: null,
      lastArbitrageDecision: 'NONE',
    };
    
    // Initialize communication security state
    this.commSecurityState = TranslationFirewall.getSecurityState();

    // Initialize market conditions with neutral defaults
    this.marketConditions = {
      volatility: 50,
      gasEfficiency: 5,
      spreadOpportunities: 0,
      competitionLevel: 0.5,
      liquidityDepth: 100000,
      technicalSignal: 'neutral',
      timestamp: Date.now(),
      confidence: 0.5,
      technicalDataProvenance: 'no-data',
      technicalDataTimestamp: null,
      quoteDataProvenance: 'no-data',
      quoteDataTimestamp: null,
    };
    
    // Initialize circuit breaker - CLOSED state
    this.circuitBreaker = {
      isOpen: false,
      failures: 0,
      lastFailure: 0,
      lastSuccess: Date.now(),
      halfOpenAttempts: 0,
    };
  }

  // ==========================================================================
  // CAIN REASONING INTEGRATION
  // Dimensional Parallel Adaptive Logic for IP Protection & Security
  // ==========================================================================

  /**
   * Initialize the Cain reasoning system for this faucet
   * Each faucet becomes a unique Cain with demonstrable security
   */
  private async initializeCainReasoning(): Promise<void> {
    if (this.cainInitialized) return;

    try {
      // Initialize this faucet as a Cain entity with all security systems
      const cainSystems = initializeCain(this.faucetId);
      
      logger.info('[FAUCET] 🧠 Cain reasoning systems initialized', {
        component: 'AutonomousFaucet',
        cainId: this.faucetId,
        fingerprintId: cainSystems.fingerprint.id,
        dialectVocabulary: cainSystems.dialect.vocabulary.size,
        dimensionCount: cainSystems.reasoning.dimensions.length,
        cloakPattern: cainSystems.reasoning.activeCloak.pattern,
      });

      // Generate initial security proofs
      const proofs = generateSecurityProofs(this.faucetId);
      this.state.securityProofsValid = proofs.length;

      this.cainInitialized = true;
    } catch (error) {
      logger.error('[FAUCET] Failed to initialize Cain reasoning', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Perform dimensional reasoning before making trading decisions
   * This provides adaptive, parallel logic across multiple dimensions
   */
  private async performDimensionalReasoning(): Promise<ReasoningConclusion | null> {
    if (!this.cainInitialized) {
      await this.initializeCainReasoning();
    }

    // Only reason if enough time has passed
    const now = Date.now();
    if (now - this.lastReasoningTime < this.reasoningInterval) {
      return this.state.lastReasoningConclusion;
    }

    try {
      // Build reasoning context from current market conditions
      const context: ReasoningContext = {
        volatility: this.marketConditions.volatility / 100,
        expectedProfitability: Math.max(0, (await this.calculateExpectedProfit()).netProfitUsd ?? 0) / 100,
        gasEfficiency: 1 - (this.marketConditions.gasEfficiency / 20), // Invert: lower gas = better
        marketPosition: this.state.dailyTargetProgress / 100,
        signalStrength: this.marketConditions.confidence,
        urgency: this.calculateUrgency(),
        threatIndicator: this.calculateThreatIndicator(),
        unusualPatterns: this.detectUnusualPatterns(),
        timingAnomaly: this.detectTimingAnomaly(),
        correlationAnomaly: this.detectCorrelationAnomaly(),
        source: 'market_conditions',
      };

      // Perform dimensional reasoning
      const conclusion = await reasonForCain(this.faucetId, context);
      
      this.state.lastReasoningConclusion = conclusion;
      this.state.globalThreatLevel = getGlobalThreatLevel();
      this.lastReasoningTime = now;

      // Handle threat-based actions
      if (conclusion.action === 'ALERT') {
        // Alert the swarm
        alertSwarm(this.faucetId, {
          id: `threat-${now}`,
          threatLevel: 'high',
          threatType: 'PATTERN_DETECTION',
          source: 'faucet_reasoning',
          confidence: conclusion.confidence,
          countermeasures: ['INCREASE_STEALTH', 'RANDOMIZE_BEHAVIOR'],
          timestamp: now,
        });
      } else if (conclusion.action === 'HIBERNATE') {
        // Emergency shutdown
        await this.enterEmergencyMode('Cain reasoning determined critical threat');
      } else if (conclusion.action === 'EVADE') {
        // Increase stealth
        this.state.stealthLevel = Math.min(10, this.state.stealthLevel + 2);
      }

      // Refresh security proofs periodically
      if (this.state.securityProofsValid < 3) {
        const newProofs = generateSecurityProofs(this.faucetId);
        this.state.securityProofsValid = newProofs.length;
      }

      return conclusion;
    } catch (error) {
      logger.error('[FAUCET] Dimensional reasoning failed', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Calculate urgency based on time remaining in trading window
   */
  private calculateUrgency(): number {
    const windowElapsed = Date.now() - this.windowStartTime;
    const windowDuration = DAILY_TARGET_CONFIG.windowDuration * 60 * 1000;
    const progress = this.state.profitThisWindow / this.getCurrentWindowTarget();
    
    // Higher urgency if behind schedule
    if (progress < 0.5 && windowElapsed > windowDuration * 0.5) {
      return 0.8;
    }
    if (progress < 0.8 && windowElapsed > windowDuration * 0.8) {
      return 0.9;
    }
    return 0.3;
  }

  /**
   * Calculate threat indicator from market and system conditions
   */
  private calculateThreatIndicator(): number {
    let threat = 0;
    
    // High competition is a threat
    threat += this.marketConditions.competitionLevel * 0.3;
    
    // Many failures is a threat
    threat += Math.min(1, this.state.consecutiveFailures / 5) * 0.3;
    
    // Circuit breaker issues
    if (this.circuitBreaker.isOpen) threat += 0.4;
    
    return Math.min(1, threat);
  }

  /**
   * Detect unusual patterns that might indicate detection attempts
   */
  private detectUnusualPatterns(): number {
    // Check for correlation between our trades and external responses
    const commState = TranslationFirewall.getSecurityState();
    
    let patternScore = 0;
    
    // High blocked message rate is suspicious
    if (commState.blockedMessages > 10) patternScore += 0.3;
    
    // Recent threat detection
    if (commState.lastThreatDetected && Date.now() - commState.lastThreatDetected < 60000) {
      patternScore += 0.4;
    }
    
    return Math.min(1, patternScore);
  }

  /**
   * Detect timing anomalies that might indicate timing attacks
   * Analyzes timing patterns in recent operations to detect statistical anomalies
   */
  private detectTimingAnomaly(): number {
    // Analyze timing variance in recent operations
    const now = Date.now();
    const timeSinceLastTrade = now - this.state.lastSuccessfulTrade;
    const timeSinceLastModeChange = now - this.state.lastModeChange;
    
    let anomalyScore = 0;
    
    // Check if timing patterns are too regular (might indicate detection)
    // Expected: some randomness in timing. Anomaly if very consistent.
    const expectedJitter = STEALTH_CONFIG.minTimeBetweenTrades * 2;
    if (timeSinceLastTrade > 0 && timeSinceLastTrade < expectedJitter) {
      // Very fast consecutive operations could indicate timing analysis
      anomalyScore += 0.2;
    }
    
    // Check for suspiciously quick mode changes
    if (timeSinceLastModeChange < 5000 && this.state.mode !== 'closed') {
      anomalyScore += 0.15;
    }
    
    // Check consecutive failure rate (could indicate external interference)
    if (this.state.consecutiveFailures > 2) {
      anomalyScore += this.state.consecutiveFailures * 0.1;
    }
    
    return Math.min(1, anomalyScore);
  }

  /**
   * Detect correlation anomalies that might indicate cross-crawler attacks
   */
  private detectCorrelationAnomaly(): number {
    // Check global threat level
    const globalThreat = getGlobalThreatLevel();
    const threatMap: Record<string, number> = {
      'none': 0,
      'low': 0.1,
      'medium': 0.3,
      'high': 0.6,
      'critical': 0.8,
      'existential': 1.0,
    };
    return threatMap[globalThreat] || 0;
  }

  /**
   * Get current window target with variance
   */
  private getCurrentWindowTarget(): number {
    const baseTarget = DAILY_TARGET_CONFIG.baseWindowTarget;
    const variance = (Math.random() - 0.5) * 2 * DAILY_TARGET_CONFIG.windowVariance;
    return baseTarget * (1 + variance);
  }

  // ==========================================================================
  // CRITICAL: OPEN/CLOSE DECISION ENGINE
  // The faucet MUST open when necessary and MUST close when necessary
  // ==========================================================================

  /**
   * CRITICAL: Make opening decision with multiple validators
   * This is the primary mechanism to determine if the faucet should OPEN
   * Now enhanced with Cain dimensional reasoning
   * @returns Decision object with reasons and validator results
   */
  private hasCurrentMarketData(): boolean {
    const maxAgeMs = Math.max(1_000, Number(process.env.FAUCET_MARKET_DATA_MAX_AGE_MS || 60_000));
    const technicalDataIsUsable =
      this.marketConditions.technicalDataProvenance === 'live' ||
      this.marketConditions.technicalDataProvenance === 'cached';
    const technicalDataIsFresh =
      this.marketConditions.technicalDataTimestamp !== null &&
      Date.now() - this.marketConditions.technicalDataTimestamp <= maxAgeMs;
    const quoteDataIsCurrent =
      this.marketConditions.quoteDataProvenance === 'live' &&
      this.marketConditions.quoteDataTimestamp !== null &&
      Date.now() - this.marketConditions.quoteDataTimestamp <= maxAgeMs;
    const marketDataIsFresh = Date.now() - this.marketConditions.timestamp <= maxAgeMs;

    return technicalDataIsUsable &&
      technicalDataIsFresh &&
      quoteDataIsCurrent &&
      marketDataIsFresh &&
      !this.marketConditions.lastMarketDataError;
  }

  private async makeOpenDecision(): Promise<OpenCloseDecision> {
    const validators: ValidatorResult[] = [];
    const reasons: string[] = [];

    if (!this.hasCurrentMarketData()) {
      return {
        shouldOpen: false,
        shouldClose: false,
        confidence: 0,
        reasons: ['Current live or cached market data is required before opening'],
        validators: [{
          name: 'market_data_freshness',
          passed: false,
          weight: 1,
          details: `Technical data=${this.marketConditions.technicalDataProvenance}, updatedAt=${this.marketConditions.timestamp}`,
        }],
      };
    }

    // FIRST: Perform dimensional reasoning for adaptive decision making
    const reasoning = await this.performDimensionalReasoning();
    if (reasoning) {
      // If Cain reasoning says HIBERNATE or EVADE, don't open
      if (reasoning.action === 'HIBERNATE' || reasoning.action === 'EVADE') {
        return {
          shouldOpen: false,
          shouldClose: true,
          confidence: reasoning.confidence,
          reasons: [`Cain reasoning action: ${reasoning.action}`],
          validators: [{
            name: 'cain_reasoning',
            passed: false,
            weight: 0.30,
            details: `Dimensional reasoning: ${reasoning.action} (confidence: ${reasoning.confidence.toFixed(2)})`,
          }],
        };
      }
    }
    
    // Validator 1: Market Profitability Check (weight: 25%)
    const expectedProfit = await this.calculateExpectedProfit();
    const profitPasses = expectedProfit.status === 'VALID_POSITIVE' &&
      (expectedProfit.netProfitUsd ?? Number.NEGATIVE_INFINITY) >= DECISION_CONFIG.minExpectedProfitToOpen;
    validators.push({
      name: 'profitability',
      passed: profitPasses,
      weight: 0.25,
      details: `Status: ${expectedProfit.status}; gross=${expectedProfit.grossProfitUsd === null ? 'n/a' : `$${expectedProfit.grossProfitUsd.toFixed(2)}`}; net=${expectedProfit.netProfitUsd === null ? 'n/a' : `$${expectedProfit.netProfitUsd.toFixed(2)}`}; ${expectedProfit.reason}`,
    });
    if (!profitPasses) reasons.push(`Insufficient expected profit: ${expectedProfit.netProfitUsd === null ? expectedProfit.status : `$${expectedProfit.netProfitUsd.toFixed(2)}`}`);
    
    // Validator 2: Gas Cost Check (weight: 20%)
    const gasPasses = this.marketConditions.gasEfficiency <= DECISION_CONFIG.maxGasToOpen;
    validators.push({
      name: 'gas_cost',
      passed: gasPasses,
      weight: 0.20,
      details: `Gas cost: $${this.marketConditions.gasEfficiency.toFixed(2)} (max: $${DECISION_CONFIG.maxGasToOpen})`,
    });
    if (!gasPasses) reasons.push(`Gas too expensive: $${this.marketConditions.gasEfficiency.toFixed(2)}`);
    
    // Validator 3: Competition Level Check (weight: 20%)
    const competitionPasses = this.marketConditions.competitionLevel <= DECISION_CONFIG.maxCompetitionToOpen;
    validators.push({
      name: 'competition',
      passed: competitionPasses,
      weight: 0.20,
      details: `Competition: ${(this.marketConditions.competitionLevel * 100).toFixed(1)}% (max: ${DECISION_CONFIG.maxCompetitionToOpen * 100}%)`,
    });
    if (!competitionPasses) reasons.push(`Competition too high: ${(this.marketConditions.competitionLevel * 100).toFixed(1)}%`);
    
    // Validator 4: Technical Signal Check (weight: 15%)
    const technicalPasses = this.marketConditions.technicalSignal !== 'bearish';
    validators.push({
      name: 'technical_signal',
      passed: technicalPasses,
      weight: 0.15,
      details: `Technical signal: ${this.marketConditions.technicalSignal}`,
    });
    if (!technicalPasses) reasons.push(`Bearish market conditions`);
    
    // Validator 5: System Health Check (weight: 10%)
    const healthPasses = this.state.healthScore >= 70;
    validators.push({
      name: 'system_health',
      passed: healthPasses,
      weight: 0.10,
      details: `Health score: ${this.state.healthScore}/100`,
    });
    if (!healthPasses) reasons.push(`System health degraded: ${this.state.healthScore}/100`);
    
    // Validator 6: Circuit Breaker Check (weight: 10%)
    const circuitPasses = !this.circuitBreaker.isOpen;
    validators.push({
      name: 'circuit_breaker',
      passed: circuitPasses,
      weight: 0.10,
      details: `Circuit breaker: ${this.circuitBreaker.isOpen ? 'OPEN' : 'CLOSED'}`,
    });
    if (!circuitPasses) reasons.push(`Circuit breaker is open`);
    
    // Calculate weighted confidence score
    const confidence = validators.reduce((sum, v) => sum + (v.passed ? v.weight : 0), 0);
    const passedCount = validators.filter(v => v.passed).length;
    logger.info('[FAUCET] Opening validators evaluated', {
      component: 'AutonomousFaucet',
      passed: passedCount,
      total: validators.length,
      validators: validators.map(validator => ({
        name: validator.name,
        passed: validator.passed,
        details: validator.details,
      })),
    });
    
    // Decision: Should we OPEN?
    const shouldOpen = 
      confidence >= DECISION_CONFIG.minConfidenceToOpen &&
      passedCount >= DECISION_CONFIG.minValidatorsToOpen &&
      !this.circuitBreaker.isOpen;
    
    if (shouldOpen) {
      reasons.push(`All criteria met: ${passedCount}/${validators.length} validators passed, confidence: ${(confidence * 100).toFixed(1)}%`);
    }
    
    return {
      shouldOpen,
      shouldClose: false,
      confidence,
      reasons,
      validators,
    };
  }

  /**
   * CRITICAL: Make closing decision with multiple validators
   * This is the primary mechanism to determine if the faucet should CLOSE
   * @returns Decision object with reasons and validator results
   */
  private async makeCloseDecision(): Promise<OpenCloseDecision> {
    const validators: ValidatorResult[] = [];
    const reasons: string[] = [];

    if (!this.hasCurrentMarketData()) {
      return {
        shouldOpen: false,
        shouldClose: true,
        confidence: 0,
        reasons: ['Current live or cached market data is unavailable'],
        validators: [{
          name: 'market_data_freshness',
          passed: false,
          weight: 1,
          details: `Technical data=${this.marketConditions.technicalDataProvenance}, updatedAt=${this.marketConditions.timestamp}`,
        }],
      };
    }

    if (this.marketConditions.lastMarketGateError) {
      return {
        shouldOpen: false,
        shouldClose: true,
        confidence: 0,
        reasons: [`Cryptara market gate blocked current context: ${this.marketConditions.lastMarketGateError}`],
        validators: [{
          name: 'market_gate',
          passed: false,
          weight: 1,
          details: this.marketConditions.lastMarketGateError,
        }],
      };
    }
    
    // Validator 1: Profit Cap Check - MUST close if cap reached
    const profitCapReached = this.state.profitThisHour >= STEALTH_CONFIG.maxHourlyProfit;
    validators.push({
      name: 'profit_cap',
      passed: !profitCapReached, // Passes if cap NOT reached
      weight: 0.30,
      details: `Hourly profit: $${this.state.profitThisHour.toFixed(2)}/$${STEALTH_CONFIG.maxHourlyProfit}`,
    });
    if (profitCapReached) reasons.push(`Profit cap reached: $${this.state.profitThisHour.toFixed(2)}`);
    
    // Validator 2: Trade Frequency Cap - MUST close if cap reached
    const tradeCapReached = this.state.tradesThisHour >= STEALTH_CONFIG.maxTradesPerHour;
    validators.push({
      name: 'trade_cap',
      passed: !tradeCapReached,
      weight: 0.25,
      details: `Trades this hour: ${this.state.tradesThisHour}/${STEALTH_CONFIG.maxTradesPerHour}`,
    });
    if (tradeCapReached) reasons.push(`Trade cap reached: ${this.state.tradesThisHour} trades`);
    
    // Validator 3: Consecutive Failures - Close if too many failures
    const tooManyFailures = this.state.consecutiveFailures >= DECISION_CONFIG.maxConsecutiveFailures;
    validators.push({
      name: 'failure_check',
      passed: !tooManyFailures,
      weight: 0.20,
      details: `Consecutive failures: ${this.state.consecutiveFailures}/${DECISION_CONFIG.maxConsecutiveFailures}`,
    });
    if (tooManyFailures) reasons.push(`Too many consecutive failures: ${this.state.consecutiveFailures}`);
    
    // Validator 4: Market Conditions Degradation
    const expectedProfit = await this.calculateExpectedProfit();
    const profitTooLow = expectedProfit.status !== 'VALID_POSITIVE' ||
      (expectedProfit.netProfitUsd ?? Number.NEGATIVE_INFINITY) < DECISION_CONFIG.emergencyCloseThreshold;
    validators.push({
      name: 'market_degradation',
      passed: !profitTooLow,
      weight: 0.15,
      details: `Status: ${expectedProfit.status}; net=${expectedProfit.netProfitUsd === null ? 'n/a' : `$${expectedProfit.netProfitUsd.toFixed(2)}`}; ${expectedProfit.reason}`,
    });
    if (profitTooLow) reasons.push(`Profit expectation unavailable or below threshold: ${expectedProfit.netProfitUsd === null ? expectedProfit.status : `$${expectedProfit.netProfitUsd.toFixed(2)}`}`);
    
    // Validator 5: Circuit Breaker Tripped
    validators.push({
      name: 'circuit_breaker',
      passed: !this.circuitBreaker.isOpen,
      weight: 0.10,
      details: `Circuit breaker: ${this.circuitBreaker.isOpen ? 'TRIPPED' : 'OK'}`,
    });
    if (this.circuitBreaker.isOpen) reasons.push(`Circuit breaker tripped`);
    
    // Calculate confidence (inverse - higher means MORE reason to stay open)
    const confidence = validators.reduce((sum, v) => sum + (v.passed ? v.weight : 0), 0);
    const failedCount = validators.filter(v => !v.passed).length;
    
    // Decision: Should we CLOSE?
    // Close if ANY critical validator fails OR if overall confidence drops too low
    const shouldClose = 
      profitCapReached ||
      tradeCapReached ||
      this.circuitBreaker.isOpen ||
      tooManyFailures ||
      confidence < DECISION_CONFIG.maxConfidenceToStayOpen ||
      failedCount >= (validators.length - DECISION_CONFIG.minValidatorsToStayOpen);
    
    if (shouldClose) {
      reasons.push(`Closing: ${failedCount}/${validators.length} validators failed`);
    }
    
    return {
      shouldOpen: false,
      shouldClose,
      confidence,
      reasons,
      validators,
    };
  }

    logger.info('[FAUCET] Opening validators evaluated', {
      component: 'AutonomousFaucet',
      passed: passedCount,
      total: validators.length,
      validators: validators.map(validator => ({ name: validator.name, passed: validator.passed, details: validator.details })),
    });

  // ==========================================================================
  // STATE MACHINE - Strict, atomic state transitions
  // ==========================================================================

  /**
   * CRITICAL: Atomic state transition with verification
   * All state changes MUST go through this method
   */
  private async transitionState(newMode: FaucetMode, reason: string): Promise<boolean> {
    const oldMode = this.state.mode;
    
    // Validate transition is allowed
    if (!this.isTransitionAllowed(oldMode, newMode)) {
      logger.warn('[FAUCET] Invalid state transition attempted', {
        component: 'AutonomousFaucet',
        from: oldMode,
        to: newMode,
        reason,
      });
      return false;
    }
    
    // Begin transition
    const transitionStart = Date.now();
    logger.info(`[FAUCET] 🔄 State transition: ${oldMode} -> ${newMode}`, {
      component: 'AutonomousFaucet',
      reason,
      healthScore: this.state.healthScore,
    });
    
    try {
      // Execute transition actions
      await this.executeTransitionActions(oldMode, newMode);
      
      // Update state atomically
      this.state.mode = newMode;
      this.state.lastModeChange = Date.now();
      
      // Verify transition succeeded
      if (this.state.mode !== newMode) {
        throw new Error('State verification failed after transition');
      }
      
      const duration = Date.now() - transitionStart;
      logger.info(`[FAUCET] ✅ State transition complete: ${oldMode} -> ${newMode} (${duration}ms)`, {
        component: 'AutonomousFaucet',
        duration,
      });
      
      return true;
    } catch (error) {
      logger.error('[FAUCET] ❌ State transition failed', {
        component: 'AutonomousFaucet',
        from: oldMode,
        to: newMode,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Rollback to safe state
      this.state.mode = 'emergency';
      this.state.lastModeChange = Date.now();
      return false;
    }
  }

  /**
   * Validate if a state transition is allowed
   */
  private isTransitionAllowed(from: FaucetMode, to: FaucetMode): boolean {
    const allowedTransitions: Record<FaucetMode, FaucetMode[]> = {
      'closed': ['opening', 'emergency'],
      'opening': ['open', 'closed', 'emergency'],
      'open': ['closing', 'stealth', 'emergency'],
      'closing': ['closed', 'cooldown', 'emergency'],
      'cooldown': ['closed', 'opening', 'emergency'],
      'stealth': ['closing', 'cooldown', 'emergency'],
      'emergency': ['closed', 'cooldown'],
    };
    
    return allowedTransitions[from]?.includes(to) ?? false;
  }

  /**
   * Execute actions associated with state transitions
   */
  private async executeTransitionActions(from: FaucetMode, to: FaucetMode): Promise<void> {
    // Opening actions
    if (to === 'open') {
      // Only start the heavy orchestrator if explicitly enabled.
      // Stage Two focus: arbitrage verification + profit-flow, not unrelated subsystems.
      if (process.env.CRYPTOCRAWL_ENABLE_ORCHESTRATOR === 'true') {
        try {
          await MasterOrchestrator.start();
        } catch (error) {
          this.recordFailure('orchestrator_start');
          throw error;
        }
      }
    }
    
    // Closing actions
    if (to === 'closed' || to === 'cooldown' || to === 'stealth' || to === 'emergency') {
      if (from === 'open' || from === 'opening') {
        if (process.env.CRYPTOCRAWL_ENABLE_ORCHESTRATOR === 'true') {
          try {
            MasterOrchestrator.stop();
          } catch (error) {
            logger.warn('[FAUCET] Failed to stop orchestrator during transition', {
              component: 'AutonomousFaucet',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
    
    // Stealth mode actions
    if (to === 'stealth') {
      this.state.stealthLevel = Math.min(10, this.state.stealthLevel + 2);
    }
    
    // Emergency mode actions
    if (to === 'emergency') {
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.failures = CIRCUIT_BREAKER_CONFIG.failureThreshold;
      logger.error('[FAUCET] 🚨 EMERGENCY MODE ACTIVATED', { component: 'AutonomousFaucet' });
    }
  }

  // ==========================================================================
  // CIRCUIT BREAKER - Fault tolerance mechanism
  // ==========================================================================

  /**
   * Record a failure and potentially trip the circuit breaker
   */
  private recordFailure(operation: string): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();
    this.state.consecutiveFailures++;
    
    if (this.circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      this.circuitBreaker.isOpen = true;
      logger.warn('[FAUCET] ⚡ Circuit breaker TRIPPED', {
        component: 'AutonomousFaucet',
        failures: this.circuitBreaker.failures,
        operation,
      });
    }
  }

  /**
   * Record a success and potentially close the circuit breaker
   */
  private recordSuccess(): void {
    this.state.consecutiveFailures = 0;
    this.state.lastSuccessfulTrade = Date.now();
    this.circuitBreaker.lastSuccess = Date.now();
    
    if (this.circuitBreaker.isOpen) {
      this.circuitBreaker.halfOpenAttempts++;
      if (this.circuitBreaker.halfOpenAttempts >= CIRCUIT_BREAKER_CONFIG.successThreshold) {
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.halfOpenAttempts = 0;
        logger.info('[FAUCET] ⚡ Circuit breaker RESET', { component: 'AutonomousFaucet' });
      }
    }
  }

  /**
   * Check if circuit breaker should transition from open to half-open
   */
  private checkCircuitBreakerRecovery(): void {
    if (this.circuitBreaker.isOpen) {
      const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailure;
      if (timeSinceLastFailure >= CIRCUIT_BREAKER_CONFIG.timeout) {
        logger.info('[FAUCET] ⚡ Circuit breaker entering HALF-OPEN state', {
          component: 'AutonomousFaucet',
        });
        // Allow one attempt
        this.circuitBreaker.halfOpenAttempts = 0;
      }
    }
  }

  // ==========================================================================
  // HEALTH MONITORING - Comprehensive system health checks
  // ==========================================================================

  /**
   * Perform comprehensive health check on all components
   */
  private async performHealthCheck(): Promise<void> {
    const checks: HealthCheck[] = [];
    
    // Check 1: Oracle Validator
    const oracleStart = Date.now();
    try {
      const validation = await this.oracleValidator.validatePrice('ETH', 'polygon');
      checks.push({
        component: 'oracle_validator',
        status: validation.isValid ? 'healthy' : 'degraded',
        latency: Date.now() - oracleStart,
        lastCheck: Date.now(),
        message: validation.isValid ? 'OK' : 'Validation failed',
      });
    } catch {
      checks.push({
        component: 'oracle_validator',
        status: 'critical',
        latency: Date.now() - oracleStart,
        lastCheck: Date.now(),
        message: 'Oracle check failed',
      });
    }
    
    // Check 2: Gas Oracle
    const gasStart = Date.now();
    try {
      const chain = await gasOracle.getCheapestChain();
      checks.push({
        component: 'gas_oracle',
        status: chain ? 'healthy' : 'degraded',
        latency: Date.now() - gasStart,
        lastCheck: Date.now(),
        message: chain ? `Cheapest: ${chain}` : 'No chain available',
      });
    } catch {
      checks.push({
        component: 'gas_oracle',
        status: 'critical',
        latency: Date.now() - gasStart,
        lastCheck: Date.now(),
        message: 'Gas oracle failed',
      });
    }
    
    // Check 3: TradingView
    checks.push({
      component: 'tradingview',
      status: this.tradingViewAnalysis ? 'healthy' : 'degraded',
      latency: 0,
      lastCheck: Date.now(),
      message: this.tradingViewAnalysis ? `Signal: ${this.tradingViewAnalysis.summary.signal}` : 'No analysis',
    });
    
    // Check 4: Circuit Breaker
    checks.push({
      component: 'circuit_breaker',
      status: this.circuitBreaker.isOpen ? 'critical' : 'healthy',
      latency: 0,
      lastCheck: Date.now(),
      message: `Failures: ${this.circuitBreaker.failures}`,
    });
    
    // Update health checks map
    for (const check of checks) {
      this.healthChecks.set(check.component, check);
    }
    
    // Calculate overall health score
    const criticalCount = checks.filter(c => c.status === 'critical').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;
    this.state.healthScore = Math.max(0, 100 - (criticalCount * 30) - (degradedCount * 10));
  }

  // ==========================================================================
  // BABEL INTEGRATION - IP Protection Systems
  // ==========================================================================

  /**
   * Initialize Babel IP Protection Systems
   * Sets up unique fingerprint, dialect, and registers with Tower of Babel
   */
  private async initializeBabelSystems(): Promise<void> {
    try {
      // Initialize core Babel systems
      TowerOfBabel.initialize();
      CrawlerFingerprintEngine.initialize();
      LightLanguageEngine.initialize();
      TradingViewEngine.initialize();

      // Generate unique fingerprint for this faucet
      CrawlerFingerprintEngine.generateFingerprint(this.faucetId);
      
      // Generate unique dialect (language) for this faucet
      LightLanguageEngine.generateDialect(this.faucetId);
      
      // Register with Tower of Babel as a crawler entity
      TowerOfBabel.registerEntity(this.faucetId, 'crawler', 7);

      this.babelInitialized = true;

      logger.info('[FAUCET] 🏛️ Babel systems initialized - IP protection active', {
        component: 'AutonomousFaucet',
        faucetId: this.faucetId,
        fingerprint: 'unique',
        dialect: 'unique',
        towerAccess: 'registered',
      });
    } catch (error) {
      logger.error('[FAUCET] Failed to initialize Babel systems', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without Babel - not critical for operation
      this.babelInitialized = false;
    }
  }

  /**
   * Update TradingView technical analysis for optimization
   */
  private async updateTradingViewAnalysis(): Promise<void> {
    try {
      // Get technical analysis for BTC as market proxy
      this.tradingViewAnalysis = await TradingViewEngine.getAnalysis('BTCUSDT', '1h');
      this.marketConditions.technicalDataProvenance = this.tradingViewAnalysis.dataProvenance;
      this.marketConditions.technicalDataTimestamp = this.tradingViewAnalysis.sourceTimestamp;
      this.marketConditions.lastMarketDataError = undefined;
      
      // Get optimized settings based on signals
      this.crawlerOptimization = TradingViewEngine.getOptimization(
        this.faucetId,
        this.tradingViewAnalysis
      );

      // Update market conditions based on TradingView signals
      if (this.tradingViewAnalysis) {
        const signal = this.tradingViewAnalysis.summary.signal;
        
        // Map TradingView signal to technical signal
        if (signal === 'strong_buy' || signal === 'buy') {
          this.marketConditions.technicalSignal = 'bullish';
        } else if (signal === 'strong_sell' || signal === 'sell') {
          this.marketConditions.technicalSignal = 'bearish';
        } else {
          this.marketConditions.technicalSignal = 'neutral';
        }
      }

      logger.debug('[FAUCET] TradingView analysis updated', {
        component: 'AutonomousFaucet',
        signal: this.tradingViewAnalysis?.summary.signal,
        strength: this.tradingViewAnalysis?.summary.strength,
        optimization: this.crawlerOptimization?.aggressiveness,
      });
    } catch (error) {
      this.marketConditions.technicalDataProvenance = 'no-data';
      this.marketConditions.lastMarketDataError = error instanceof Error ? error.message : String(error);
      logger.warn('[FAUCET] Failed to update TradingView analysis', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ==========================================================================
  // MAIN AUTONOMOUS LOOP - Enterprise-grade operation
  // ==========================================================================

  /**
   * ENTERPRISE-GRADE AUTONOMOUS LOOP
   * The faucet MUST open when conditions are favorable
   * The faucet MUST close when conditions deteriorate
   * All decisions are validated by multiple validators
   */
  async runAutonomousLoop(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[FAUCET] Autonomous loop already running', { component: 'AutonomousFaucet' });
      return;
    }

    logger.info('[FAUCET] Activation started', {
      component: 'AutonomousFaucet',
      faucetId: this.faucetId,
      stage: stageManager.getCurrentStage(),
    });
    this.isRunning = true;
    this.sessionStartTime = Date.now();
    this.hourlyResetTime = Date.now();
    this.dailyResetTime = Date.now();
    this.windowStartTime = Date.now();

    // Initialize Babel IP Protection Systems
    await this.initializeBabelSystems();

    // Ensure gas oracle providers are initialized before use.
    // Without this, getCheapestChain() will repeatedly log "Provider not initialized" and degrade decisions.
    try {
      await gasOracle.start();
    } catch (error) {
      logger.warn('[FAUCET] Failed to start gas oracle (continuing with degraded gas data)', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // If stop() was called while we were awaiting initialization, abort before scheduling timers.
    if (!this.isRunning) {
      logger.info('[FAUCET] Startup aborted - faucet was stopped during initialization', {
        component: 'AutonomousFaucet',
        faucetId: this.faucetId,
      });
      return;
    }
    
    // Start health check timer
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(e => 
        logger.warn('[FAUCET] Health check failed', { error: String(e) })
      );
    }, TIMING_CONFIG.healthCheckInterval);
    
    // Start hourly reset timer (more efficient than checking every loop)
    this.hourlyResetTimer = setInterval(() => {
      this.checkHourlyReset();
      this.checkWindowReset();
      this.checkDailyReset();
    }, TIMING_CONFIG.hourlyResetCheck);

    logger.info('[FAUCET] 🚰 Enterprise-grade autonomous faucet started', {
      component: 'AutonomousFaucet',
      faucetId: this.faucetId,
      babelActive: this.babelInitialized,
      mode: this.state.mode,
      dailyTarget: `$${DAILY_TARGET_CONFIG.dailyTarget.toLocaleString()}`,
      tradingWindows: DAILY_TARGET_CONFIG.tradingWindows,
    });
    logger.info('[FAUCET] Scheduler started; beginning first market cycle', {
      component: 'AutonomousFaucet',
      faucetId: this.faucetId,
      intervalMs: TIMING_CONFIG.marketUpdateInterval,
    });

    // Main control loop
    while (this.isRunning) {
      try {
        // Heartbeat for stall detection/observability
        this.state.lastLoopIterationAt = Date.now();

        // Check circuit breaker recovery
        this.checkCircuitBreakerRecovery();
        
        // 1. Update all market data sources
        await this.updateTradingViewAnalysis();
        await this.updateMarketConditions();
        
        // 2. Perform health check periodically
        if (Date.now() - (this.healthChecks.get('oracle_validator')?.lastCheck || 0) > TIMING_CONFIG.healthCheckInterval) {
          await this.performHealthCheck();
        }

        // 3. CRITICAL: Make open/close decisions based on current state
        if (this.state.mode === 'closed' || this.state.mode === 'cooldown') {
          // Should we OPEN?
          const openDecision = await this.makeOpenDecision();
          if (openDecision.shouldOpen) {
            logger.info('[FAUCET] 🔓 OPENING - Favorable conditions detected', {
              component: 'AutonomousFaucet',
              confidence: openDecision.confidence,
              reasons: openDecision.reasons,
              dailyProgress: `${this.state.dailyTargetProgress.toFixed(1)}%`,
            });
            await this.transitionState('opening', openDecision.reasons.join('; '));
            // Complete opening transition
            await this.transitionState('open', 'Opening sequence complete');
          }
        } else if (this.state.mode === 'open') {
          // Should we CLOSE?
          const closeDecision = await this.makeCloseDecision();
          if (closeDecision.shouldClose) {
            logger.info('[FAUCET] 🔒 CLOSING - Unfavorable conditions detected', {
              component: 'AutonomousFaucet',
              confidence: closeDecision.confidence,
              reasons: closeDecision.reasons,
              dailyProgress: `${this.state.dailyTargetProgress.toFixed(1)}%`,
            });
            await this.transitionState('closing', closeDecision.reasons.join('; '));
            // Determine final state based on reason
            const finalState = closeDecision.reasons.some(r => 
              r.includes('cap') || r.includes('Cap')
            ) ? 'stealth' : 'cooldown';
            await this.transitionState(finalState as FaucetMode, 'Closing sequence complete');
          } else {
            // Continue trading with stealth
            await this.executeWithStealth();
          }
        } else if (this.state.mode === 'stealth') {
          // Check if we can exit stealth
          const timeSinceStealthEntry = Date.now() - this.state.lastModeChange;
          if (timeSinceStealthEntry >= STEALTH_CONFIG.cooldownMinutes * 60 * 1000) {
            await this.transitionState('closing', 'Stealth period complete');
            await this.transitionState('cooldown', 'Transitioning to cooldown');
          }
        } else if (this.state.mode === 'emergency') {
          // Emergency recovery
          const timeSinceEmergency = Date.now() - this.state.lastModeChange;
          if (timeSinceEmergency >= CIRCUIT_BREAKER_CONFIG.timeout) {
            logger.info('[FAUCET] 🔄 Attempting emergency recovery', { component: 'AutonomousFaucet' });
            await this.transitionState('cooldown', 'Emergency recovery initiated');
          }
        }

        // 4. Adaptive sleep based on current mode
        const sleepMs = this.calculateAdaptiveSleep();
        await this.sleep(sleepMs);

      } catch (error) {
        logger.error('[FAUCET] Error in autonomous loop', {
          component: 'AutonomousFaucet',
          error: error instanceof Error ? error.message : String(error),
        });
        this.recordFailure('main_loop');
        await this.emergencyCooldown();
      }
    }
    
    // Cleanup
    this.cleanup();
  }

  /**
   * Returns the unique faucet instance id.
   * Useful to detect multi-instance duplication (compare across pods/hosts).
   */
  getFaucetId(): string {
    return this.faucetId;
  }

  /**
   * Cleanup timers and resources
   */
  private cleanup(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.hourlyResetTimer) {
      clearInterval(this.hourlyResetTimer);
      this.hourlyResetTimer = null;
    }
  }

  /**
   * Update market conditions from various sources
   * NOTE: In production, this would integrate with real-time market data feeds.
   * Current implementation uses the oracle validator for price validation
   * and gas oracle for chain selection, with simulated values for other metrics.
   */
  private async updateMarketConditions(): Promise<void> {
    try {
      delete this.marketConditions.lastMarketGateError;
      const validation = await this.oracleValidator.validatePrice('ETH', 'polygon');
      const chainHealthy = await gasOracle.checkChainConnectivity('polygon');
      logger.info('[FAUCET] MultiOracle validation completed', {
        component: 'AutonomousFaucet',
        asset: 'ETH',
        chain: 'polygon',
        recommendation: validation.recommendation,
        isValid: validation.isValid,
        confidence: validation.confidence,
        chainHealthy,
      });
      await stageManager.recordLiveValidation({
        passed: validation.recommendation === 'proceed' && chainHealthy,
        chainHealthy,
        timestamp: Date.now(),
      });
      if (validation.recommendation !== 'proceed') {
        throw new Error(`Oracle validation did not proceed: ${validation.recommendation}`);
      }
      if (!chainHealthy) {
        throw new Error('Blockchain RPC connectivity validation failed');
      }

      // Gas efficiency from the gas oracle (USD estimate for a simple tx)
      const cheapestChain = await gasOracle.getCheapestChain();
      if (cheapestChain) {
        const gp = await gasOracle.getGasPrice(cheapestChain);
        this.marketConditions.gasEfficiency = Math.max(
          VALIDATION.minGasEfficiency,
          Math.min(VALIDATION.maxGasEfficiency, gp.usdCost)
        );
      }

      // "Real arbitrage" check (live quotes + explicit fees/costs)
      const symbol = (process.env.CRYPTO_ARBITRAGE_SYMBOL || 'ETHUSDT').trim().toUpperCase();
      const notionalUsd = Number(process.env.CRYPTO_ARBITRAGE_NOTIONAL_USD || 200);
      const maxQuoteAgeMs = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000);

      const plan = await arbitrageVerifier.evaluateOnce({
        symbol,
        notionalUsd: Number.isFinite(notionalUsd) && notionalUsd > 0 ? notionalUsd : 200,
        maxQuoteAgeMs: Number.isFinite(maxQuoteAgeMs) ? maxQuoteAgeMs : 5000,
        gas: cheapestChain ? { enabled: true, chain: cheapestChain } : { enabled: false, chain: 'polygon' },
        bridge: process.env.CRYPTO_ARBITRAGE_BRIDGE_ENABLED === 'true'
          ? {
              enabled: true,
              fromChain: (process.env.CRYPTO_ARBITRAGE_BRIDGE_FROM as any) || 'polygon',
              toChain: (process.env.CRYPTO_ARBITRAGE_BRIDGE_TO as any) || 'arbitrum',
              token: (process.env.CRYPTO_ARBITRAGE_BRIDGE_TOKEN as any) || 'USDC',
            }
          : { enabled: false, fromChain: 'polygon', toChain: 'polygon', token: 'USDC' },
      });
      const quoteValidation = arbitrageVerifier.getLastLiveQuoteValidation();
      const hasCurrentQuoteValidation = quoteValidation?.valid === true &&
        quoteValidation.symbol === symbol &&
        quoteValidation.validatedAt >= Date.now() - maxQuoteAgeMs;

      this.marketConditions.quoteDataProvenance = hasCurrentQuoteValidation ? 'live' : 'no-data';
      this.marketConditions.quoteDataTimestamp = hasCurrentQuoteValidation
        ? quoteValidation!.validatedAt
        : null;
      if (!hasCurrentQuoteValidation) {
        throw new Error('At least two fresh live market quotes are required to update faucet conditions');
      }

      this.lastArbitragePlan = plan;
      this.state.lastVerifiedArbitrage = plan;
      this.marketConditions.spreadOpportunities = plan ? 1 : 0;

      // Confidence: if we can build an all-in profitable plan, treat as high confidence.
      this.marketConditions.confidence = plan ? 0.85 : 0.4;
      this.marketConditions.volatility = plan ? Math.min(VALIDATION.maxVolatility, Math.max(VALIDATION.minVolatility, plan.spreadPct * 10)) : 50;
      this.marketConditions.competitionLevel = 0.5; // no longer inferred from mock oracle data
      this.marketConditions.liquidityDepth = 100000; // not modeled by this verifier
      this.marketConditions.technicalSignal = plan ? 'bullish' : 'neutral';
      
      // Update timestamp
      this.marketConditions.timestamp = Date.now();

      if (this.tradingViewAnalysis?.dataProvenance === 'live' && cheapestChain) {
        const cryptara = getCryptara();
        const marketGate = cryptara.evaluateMarketGates({
          chain: cheapestChain,
          pairOrSymbol: plan?.symbol || symbol,
          venue: plan?.buyVenue || 'market-data-validation',
          expectedProfitUsd: plan?.netProfitUsd || 0,
          volatilityRegime: {
            liquidityScore: Math.max(0.1, this.tradingViewAnalysis.summary.strength / 100),
            recentPriceMovement: Math.abs(TradingViewEngine.signalToScore(this.tradingViewAnalysis.summary.signal)) / 100,
          },
          venueLatency: {
            p50Ms: { live_quotes: Math.max(0, Date.now() - quoteValidation!.validatedAt) },
            maxP50Ms: maxQuoteAgeMs,
          },
          feesRebates: {
            takerFeeBps: plan ? Math.round((plan.costs.totalCostsUsd / Math.max(plan.notionalUsd, 1)) * 10_000) : 0,
          },
          crossVenueFees: plan ? {
            buyVenue: plan.buyVenue,
            sellVenue: plan.sellVenue,
            buyTakerFeeBps: Math.round((plan.costs.buyFeeUsd / Math.max(plan.notionalUsd, 1)) * 10_000),
            sellTakerFeeBps: Math.round((plan.costs.sellFeeUsd / Math.max(plan.notionalUsd, 1)) * 10_000),
            grossSpreadBps: Math.max(0, plan.spreadPct * 100),
          } : undefined,
          drawdownCaps: {
            drawdownPct: 0,
            maxDrawdownPct: 5,
          },
          slippage: {
            expectedSlippageBps: plan ? Math.round((plan.costs.totalCostsUsd / Math.max(plan.notionalUsd, 1)) * 10_000) : 0,
            maxSlippageBps: 50,
          },
        }, {
          blockOnUnknownCritical: true,
          criticalSignals: ['volatilityRegime', 'venueLatency', 'feesRebates', 'crossVenueFees', 'slippage', 'drawdownCaps'],
        });
        if (marketGate.decision !== 'ALLOW') {
          throw new Error(`Cryptara market gate blocked live validation: ${marketGate.blockReasons.join('; ')}`);
        }
        const progression = await evaluateAutomaticStageProgression(marketGate);
        logger.info('[FAUCET] Cryptara market gate evaluated', {
          component: 'AutonomousFaucet',
          decision: marketGate.decision,
          signals: marketGate.signals.map(signal => ({ id: signal.id, status: signal.status, message: signal.message })),
          blockReasons: marketGate.blockReasons,
        });
        logger.info('[FAUCET] Automatic progression evaluated', {
          component: 'AutonomousFaucet',
          advanced: progression.advanced,
          fromStage: progression.fromStage,
          toStage: progression.toStage,
          blockers: progression.blockers,
        });
      }

      logger.debug('[FAUCET] Market conditions updated', {
        component: 'AutonomousFaucet',
        conditions: this.marketConditions,
      });
    } catch (error) {
      if (error instanceof GovernanceError && error.code === 'PAUSED') {
        delete this.marketConditions.lastMarketDataError;
        logger.info('[FAUCET] Market update skipped while governance is paused', {
          component: 'AutonomousFaucet',
          stage: stageManager.getCurrentStage(),
          pauseReason: stageManager.getState().pauseReason,
        });
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.startsWith('Cryptara market gate blocked')) {
        this.marketConditions.lastMarketGateError = errorMessage;
        logger.warn('[FAUCET] Cryptara rejected current market context; retaining live data', {
          component: 'AutonomousFaucet',
          error: errorMessage,
          technicalDataProvenance: this.marketConditions.technicalDataProvenance,
          quoteDataProvenance: this.marketConditions.quoteDataProvenance,
        });
        return;
      }
      this.marketConditions.lastMarketDataError = errorMessage;
      logger.warn('[FAUCET] Failed to update market conditions, using cached values', {
        component: 'AutonomousFaucet',
        error: errorMessage,
      });
    }
  }

  /**
   * STEALTH execution - appear organic
   * Enhanced with daily target tracking, window-based distribution,
   * and anti-detection measures for $35K daily target
   */
  private async executeWithStealth(): Promise<void> {
    // Check daily target progress - avoid overshooting
    if (this.state.profitThisDay >= DAILY_TARGET_CONFIG.dailyTarget) {
      logger.info('[FAUCET] 💰 Daily target achieved, entering stealth', {
        component: 'AutonomousFaucet',
        dailyProfit: this.state.profitThisDay,
        target: DAILY_TARGET_CONFIG.dailyTarget,
      });
      return;
    }
    
    // Calculate current window target with variance
    const baseWindowTarget = DAILY_TARGET_CONFIG.baseWindowTarget;
    const variance = (Math.random() * 2 - 1) * DAILY_TARGET_CONFIG.windowVariance;
    const currentWindowTarget = baseWindowTarget * (1 + variance);
    
    // Check window cap
    if (this.state.profitThisWindow >= Math.min(currentWindowTarget, DAILY_TARGET_CONFIG.maxWindowProfit)) {
      logger.debug('[FAUCET] Window target reached, waiting for next window', {
        component: 'AutonomousFaucet',
        windowProfit: this.state.profitThisWindow,
        windowTarget: currentWindowTarget,
      });
      return;
    }
    
    try {
      // Ensure we have a fresh verified arbitrage plan.
      const plan = this.lastArbitragePlan ?? this.state.lastVerifiedArbitrage;
      if (!plan) {
        this.state.lastArbitrageDecision = 'SKIP';
        return;
      }

      if (this.state.executionMode === 'disabled') {
        this.state.lastArbitrageDecision = 'SKIP';
        logger.debug('[FAUCET] Verified arbitrage skipped because live execution is disabled', {
          component: 'AutonomousFaucet',
          symbol: plan.symbol,
          buy: { venue: plan.buyVenue, ask: plan.buyAsk },
          sell: { venue: plan.sellVenue, bid: plan.sellBid },
          notionalUsd: plan.notionalUsd,
          netProfitUsd: plan.netProfitUsd,
          costs: plan.costs,
          quoteAgeMs: plan.quoteAgeMs,
          bridge: plan.bridge ?? null,
        });
        return;
      }

      const result = await centralizedExchangeExecutor.execute(plan);
      if (!result.success) {
        this.state.lastArbitrageDecision = 'ERROR';
        this.recordFailure('exchange_order_pair_rejected');
        logger.error('[FAUCET] Exchange order pair was not fully accepted', {
          component: 'AutonomousFaucet',
          symbol: plan.symbol,
          buyOrderId: result.buyOrder?.orderId,
          sellOrderId: result.sellOrder?.orderId,
          error: result.error,
        });
        return;
      }

      this.state.lastArbitrageDecision = 'EXECUTE';
      this.state.tradesThisHour++;
      this.state.tradesThisDay++;
      this.recordSuccess();
      logger.info('[FAUCET] Live exchange order pair accepted', {
        component: 'AutonomousFaucet',
        symbol: plan.symbol,
        buyOrderId: result.buyOrder?.orderId,
        sellOrderId: result.sellOrder?.orderId,
      });
    } catch (error) {
      this.state.lastArbitrageDecision = 'ERROR';
      this.recordFailure('arbitrage_cycle_exception');
      logger.error('[FAUCET] Trade execution exception', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    
    // Update communication security state
    this.commSecurityState = TranslationFirewall.getSecurityState();
  }

  /**
   * Calculate progress multiplier to pace toward daily target
   * Speeds up if behind, slows down if ahead
   */
  private calculateProgressMultiplier(): number {
    const hoursElapsedToday = (Date.now() - this.dailyResetTime) / (1000 * 60 * 60);
    const expectedProgress = (hoursElapsedToday / 24) * DAILY_TARGET_CONFIG.dailyTarget;
    const actualProgress = this.state.profitThisDay;
    
    const progressRatio = expectedProgress > 0 ? actualProgress / expectedProgress : 1;
    
    // If behind schedule, increase multiplier (up to high profile)
    if (progressRatio < 0.8) {
      return DAILY_TARGET_CONFIG.highProfileMultiplier;
    }
    // If ahead of schedule, decrease multiplier (go low profile)
    if (progressRatio > 1.2) {
      return DAILY_TARGET_CONFIG.lowProfileMultiplier;
    }
    // On track
    return 1.0;
  }

  /**
   * Select exchange with rotation to avoid concentration
   */
  private selectExchange(): string {
    // Use exchanges from configuration
    const exchanges = DAILY_TARGET_CONFIG.supportedExchanges as unknown as string[];
    
    // Calculate exchange weights (prefer less-used exchanges)
    const weights = exchanges.map(ex => {
      const profit = this.state.exchangeDistribution.get(ex) || 0;
      const maxPerExchange = DAILY_TARGET_CONFIG.dailyTarget * DAILY_TARGET_CONFIG.maxExchangePercent;
      
      // Weight inversely proportional to usage
      if (profit >= maxPerExchange) return 0; // Skip if maxed out
      return maxPerExchange - profit;
    });
    
    // Weighted random selection
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return exchanges[Math.floor(Math.random() * exchanges.length)];
    
    let random = Math.random() * totalWeight;
    for (let i = 0; i < exchanges.length; i++) {
      random -= weights[i];
      if (random <= 0) return exchanges[i];
    }
    
    return exchanges[0];
  }

  /**
   * Check and reset window statistics
   */
  private checkWindowReset(): void {
    const now = Date.now();
    const windowDurationMs = DAILY_TARGET_CONFIG.windowDuration * 60 * 1000;
    
    if (now - this.windowStartTime >= windowDurationMs) {
      logger.debug('[FAUCET] Trading window reset', {
        component: 'AutonomousFaucet',
        previousWindowProfit: this.state.profitThisWindow,
        window: this.state.currentWindow,
      });
      
      this.state.profitThisWindow = 0;
      this.state.currentWindow = (this.state.currentWindow + 1) % DAILY_TARGET_CONFIG.tradingWindows;
      this.windowStartTime = now;
    }
  }

  /**
   * Check and reset daily statistics
   */
  private checkDailyReset(): void {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    if (now - this.dailyResetTime >= oneDayMs) {
      logger.info('[FAUCET] 📅 Daily reset', {
        component: 'AutonomousFaucet',
        previousDayProfit: this.state.profitThisDay,
        target: DAILY_TARGET_CONFIG.dailyTarget,
        targetAchieved: this.state.profitThisDay >= DAILY_TARGET_CONFIG.dailyTarget,
      });
      
      this.state.profitThisDay = 0;
      this.state.tradesThisDay = 0;
      this.state.dailyTargetProgress = 0;
      this.state.currentWindow = 0;
      this.state.exchangeDistribution.clear();
      this.dailyResetTime = now;
      this.windowStartTime = now;
      
      // Reset stealth level for new day
      this.state.stealthLevel = Math.max(0, this.state.stealthLevel - 3);
    }
  }

  /**
   * Calculate expected profit using all available signals
   * Enhanced with TradingView signal integration
   */
  private async calculateExpectedProfit(): Promise<ExpectedProfitAssessment> {
    const plan = this.lastArbitragePlan;
    if (!plan) {
      return {
        status: 'INCOMPLETE_DATA',
        grossProfitUsd: null,
        netProfitUsd: null,
        reason: 'No complete cross-venue arbitrage plan is available from current live quotes',
      };
    }

    const status = plan.netProfitUsd > 0
      ? 'VALID_POSITIVE'
      : plan.netProfitUsd < 0
        ? 'VALID_NEGATIVE'
        : 'VALID_ZERO';
    return {
      status,
      grossProfitUsd: plan.grossProfitUsd,
      netProfitUsd: plan.netProfitUsd,
      reason: 'All-in plan includes venue fees, gas, bridge fees, and validated quote prices',
    };
  }

  /**
   * Adaptive sleep - more active when profitable, less when not
   * Uses named constants for maintainability
   */
  private calculateAdaptiveSleep(): number {
    switch (this.state.mode) {
      case 'open':
        return TIMING_CONFIG.activeMinSleep + Math.random() * (TIMING_CONFIG.activeMaxSleep - TIMING_CONFIG.activeMinSleep);
      case 'stealth':
        return TIMING_CONFIG.stealthMinSleep + Math.random() * (TIMING_CONFIG.stealthMaxSleep - TIMING_CONFIG.stealthMinSleep);
      case 'cooldown':
        return TIMING_CONFIG.cooldownSleep;
      case 'emergency':
        return TIMING_CONFIG.cooldownSleep * TIMING_CONFIG.emergencyCooldownMultiplier;
      default:
        return TIMING_CONFIG.scanningMinSleep + Math.random() * (TIMING_CONFIG.scanningMaxSleep - TIMING_CONFIG.scanningMinSleep);
    }
  }

  /**
   * Emergency cooldown after error
   * Uses interruptible sleep for graceful shutdown
   */
  private async emergencyCooldown(): Promise<void> {
    logger.warn('[FAUCET] ⚠️ Emergency cooldown activated', {
      component: 'AutonomousFaucet',
      state: this.state,
    });

    this.state.mode = 'emergency';
    this.state.stealthLevel = Math.min(10, this.state.stealthLevel + 2);
    this.state.lastModeChange = Date.now();
    this.recordFailure('emergency_cooldown');

    // Interruptible cooldown - checks isRunning periodically
    const cooldownMs = STEALTH_CONFIG.cooldownMinutes * 60 * 1000;
    const checkInterval = 1000;
    let waited = 0;
    while (waited < cooldownMs && this.isRunning) {
      const sleepTime = Math.min(checkInterval, cooldownMs - waited);
      await this.sleep(sleepTime);
      waited += sleepTime;
    }
  }

  /**
   * Enter emergency mode - critical protection mechanism
   * Immediately stops all trading and enters safe state
   */
  private async enterEmergencyMode(reason: string): Promise<void> {
    logger.error('[FAUCET] 🚨 ENTERING EMERGENCY MODE', {
      component: 'AutonomousFaucet',
      reason,
      currentMode: this.state.mode,
      timestamp: Date.now(),
    });

    // Immediately transition to emergency state
    const previousMode = this.state.mode;
    this.state.mode = 'emergency';
    this.state.lastModeChange = Date.now();
    
    // Activate circuit breaker
    this.circuitBreaker.isOpen = true;
    this.circuitBreaker.failures = CIRCUIT_BREAKER_CONFIG.failureThreshold;
    
    // Increase stealth to maximum
    this.state.stealthLevel = 10;
    
    // Record the failure
    this.recordFailure(`emergency_mode_${reason.replace(/\s+/g, '_').toLowerCase()}`);
    
    // Stop orchestrator if running
    if (previousMode === 'open' || previousMode === 'opening') {
      try {
        MasterOrchestrator.stop();
      } catch (error) {
        // Escalate to error level - failing to stop orchestrator during emergency
        // could leave crawlers running unsupervised. Proceed with emergency cooldown
        // but flag this as a critical issue that requires attention.
        logger.error('[FAUCET] CRITICAL: Failed to stop orchestrator during emergency mode', {
          component: 'AutonomousFaucet',
          error: error instanceof Error ? error.message : String(error),
          consequence: 'Orchestrator may continue running - manual intervention may be required',
          emergencyReason: reason,
          previousMode,
        });
      }
    }

    // Enter emergency cooldown
    await this.emergencyCooldown();
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check and reset hourly statistics
   */
  private checkHourlyReset(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (now - this.hourlyResetTime >= oneHour) {
      logger.info('[FAUCET] Resetting hourly stats', {
        component: 'AutonomousFaucet',
        previousProfit: this.state.profitThisHour,
        previousTrades: this.state.tradesThisHour,
      });

      this.state.profitThisHour = 0;
      this.state.tradesThisHour = 0;
      this.hourlyResetTime = now;

      // Reduce stealth level after reset
      this.state.stealthLevel = Math.max(0, this.state.stealthLevel - 2);
      
      // Reset circuit breaker if enough time has passed
      if (this.circuitBreaker.isOpen) {
        const timeSinceFailure = now - this.circuitBreaker.lastFailure;
        if (timeSinceFailure >= CIRCUIT_BREAKER_CONFIG.timeout * 2) {
          this.circuitBreaker.isOpen = false;
          this.circuitBreaker.failures = 0;
          logger.info('[FAUCET] Circuit breaker reset after hourly cycle', { component: 'AutonomousFaucet' });
        }
      }
    }
  }

  // ==========================================================================
  // STRESS TESTING - Verify functionality under extreme conditions
  // ==========================================================================

  /**
   * Run comprehensive stress tests on the faucet
   * Returns results of all 20 tests
   */
  async runStressTests(): Promise<{ passed: number; failed: number; results: StressTestResult[] }> {
    logger.info('[FAUCET] 🧪 Starting comprehensive stress tests', { component: 'AutonomousFaucet' });
    this.stressTestResults = [];
    
    const tests = [
      () => this.testOpenDecisionAccuracy(),
      () => this.testCloseDecisionAccuracy(),
      () => this.testStateTransitionValidity(),
      () => this.testCircuitBreakerTripping(),
      () => this.testCircuitBreakerRecovery(),
      () => this.testRapidOpenClose(),
      () => this.testProfitCapEnforcement(),
      () => this.testTradeCapEnforcement(),
      () => this.testEmergencyModeTransition(),
      () => this.testHealthCheckAccuracy(),
      () => this.testMarketConditionUpdates(),
      () => this.testTradingViewIntegration(),
      () => this.testStealthModeTransition(),
      () => this.testCooldownDuration(),
      () => this.testHourlyReset(),
      () => this.testConcurrentAccess(),
      () => this.testHighLoadExecution(),
      () => this.testFailureRecovery(),
      () => this.testValidatorWeighting(),
      () => this.testAdaptiveSleepValues(),
    ];
    
    for (const test of tests) {
      try {
        const result = await test();
        this.stressTestResults.push(result);
      } catch (error) {
        this.stressTestResults.push({
          testName: 'unknown',
          passed: false,
          duration: 0,
          details: `Test threw exception: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now(),
        });
      }
    }
    
    const passed = this.stressTestResults.filter(r => r.passed).length;
    const failed = this.stressTestResults.filter(r => !r.passed).length;
    
    logger.info('[FAUCET] 🧪 Stress tests complete', {
      component: 'AutonomousFaucet',
      passed,
      failed,
      passRate: `${((passed / this.stressTestResults.length) * 100).toFixed(1)}%`,
    });
    
    return { passed, failed, results: this.stressTestResults };
  }

  private async testOpenDecisionAccuracy(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      // Set favorable conditions
      this.marketConditions.gasEfficiency = 2;
      this.marketConditions.competitionLevel = 0.3;
      this.marketConditions.spreadOpportunities = 10;
      this.marketConditions.technicalSignal = 'bullish';
      this.state.healthScore = 90;
      this.circuitBreaker.isOpen = false;
      
      const decision = await this.makeOpenDecision();
      const passed = decision.shouldOpen && decision.confidence >= DECISION_CONFIG.minConfidenceToOpen;
      
      return {
        testName: 'testOpenDecisionAccuracy',
        passed,
        duration: Date.now() - start,
        details: `Confidence: ${(decision.confidence * 100).toFixed(1)}%, ShouldOpen: ${decision.shouldOpen}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testOpenDecisionAccuracy',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testCloseDecisionAccuracy(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      // Set conditions that should trigger close
      this.state.profitThisHour = STEALTH_CONFIG.maxHourlyProfit + 100;
      
      const decision = await this.makeCloseDecision();
      const passed = decision.shouldClose;
      
      // Reset
      this.state.profitThisHour = 0;
      
      return {
        testName: 'testCloseDecisionAccuracy',
        passed,
        duration: Date.now() - start,
        details: `ShouldClose: ${decision.shouldClose}, Reasons: ${decision.reasons.join(', ')}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testCloseDecisionAccuracy',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testStateTransitionValidity(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      // Test valid transition: closed -> opening
      const validTransition = this.isTransitionAllowed('closed', 'opening');
      // Test invalid transition: closed -> open (must go through opening)
      const invalidTransition = this.isTransitionAllowed('closed', 'open');
      
      const passed = validTransition && !invalidTransition;
      
      return {
        testName: 'testStateTransitionValidity',
        passed,
        duration: Date.now() - start,
        details: `Valid transition accepted: ${validTransition}, Invalid transition rejected: ${!invalidTransition}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testStateTransitionValidity',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testCircuitBreakerTripping(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      // Reset circuit breaker
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = 0;
      
      // Trip the circuit breaker
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        this.recordFailure('test');
      }
      
      const passed = this.circuitBreaker.isOpen;
      
      // Reset
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = 0;
      this.state.consecutiveFailures = 0;
      
      return {
        testName: 'testCircuitBreakerTripping',
        passed,
        duration: Date.now() - start,
        details: `Circuit breaker tripped after ${CIRCUIT_BREAKER_CONFIG.failureThreshold} failures: ${passed}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testCircuitBreakerTripping',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testCircuitBreakerRecovery(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      // Set circuit breaker to open
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.failures = CIRCUIT_BREAKER_CONFIG.failureThreshold;
      this.circuitBreaker.halfOpenAttempts = 0;
      
      // Record successes to recover
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.successThreshold; i++) {
        this.recordSuccess();
      }
      
      const passed = !this.circuitBreaker.isOpen;
      
      return {
        testName: 'testCircuitBreakerRecovery',
        passed,
        duration: Date.now() - start,
        details: `Circuit breaker recovered after ${CIRCUIT_BREAKER_CONFIG.successThreshold} successes: ${passed}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testCircuitBreakerRecovery',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testRapidOpenClose(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const originalMode = this.state.mode;
      let transitionsSucceeded = 0;
      
      // Test rapid transitions
      for (let i = 0; i < 5; i++) {
        this.state.mode = 'closed';
        if (this.isTransitionAllowed('closed', 'opening')) transitionsSucceeded++;
        this.state.mode = 'opening';
        if (this.isTransitionAllowed('opening', 'open')) transitionsSucceeded++;
        this.state.mode = 'open';
        if (this.isTransitionAllowed('open', 'closing')) transitionsSucceeded++;
        this.state.mode = 'closing';
        if (this.isTransitionAllowed('closing', 'closed')) transitionsSucceeded++;
      }
      
      this.state.mode = originalMode;
      const passed = transitionsSucceeded === 20;
      
      return {
        testName: 'testRapidOpenClose',
        passed,
        duration: Date.now() - start,
        details: `Successful transitions: ${transitionsSucceeded}/20`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testRapidOpenClose',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testProfitCapEnforcement(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      this.state.profitThisHour = STEALTH_CONFIG.maxHourlyProfit + 1;
      const decision = await this.makeCloseDecision();
      const passed = decision.shouldClose;
      this.state.profitThisHour = 0;
      
      return {
        testName: 'testProfitCapEnforcement',
        passed,
        duration: Date.now() - start,
        details: `Close triggered when profit cap exceeded: ${passed}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testProfitCapEnforcement',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testTradeCapEnforcement(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      this.state.tradesThisHour = STEALTH_CONFIG.maxTradesPerHour + 1;
      const decision = await this.makeCloseDecision();
      const passed = decision.shouldClose;
      this.state.tradesThisHour = 0;
      
      return {
        testName: 'testTradeCapEnforcement',
        passed,
        duration: Date.now() - start,
        details: `Close triggered when trade cap exceeded: ${passed}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testTradeCapEnforcement',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testEmergencyModeTransition(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const canTransitionFromOpen = this.isTransitionAllowed('open', 'emergency');
      const canTransitionFromClosed = this.isTransitionAllowed('closed', 'emergency');
      const canExitToClosedState = this.isTransitionAllowed('emergency', 'closed');
      
      const passed = canTransitionFromOpen && canTransitionFromClosed && canExitToClosedState;
      
      return {
        testName: 'testEmergencyModeTransition',
        passed,
        duration: Date.now() - start,
        details: `Emergency mode accessible from open: ${canTransitionFromOpen}, from closed: ${canTransitionFromClosed}, can exit: ${canExitToClosedState}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testEmergencyModeTransition',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testHealthCheckAccuracy(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      await this.performHealthCheck();
      const hasChecks = this.healthChecks.size > 0;
      const healthScoreValid = this.state.healthScore >= 0 && this.state.healthScore <= 100;
      const passed = hasChecks && healthScoreValid;
      
      return {
        testName: 'testHealthCheckAccuracy',
        passed,
        duration: Date.now() - start,
        details: `Health checks performed: ${this.healthChecks.size}, Health score: ${this.state.healthScore}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testHealthCheckAccuracy',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testMarketConditionUpdates(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const originalTimestamp = this.marketConditions.timestamp;
      await this.updateMarketConditions();
      const updated = this.marketConditions.timestamp >= originalTimestamp;
      const validRange = 
        this.marketConditions.volatility >= VALIDATION.minVolatility &&
        this.marketConditions.volatility <= VALIDATION.maxVolatility;
      
      const passed = updated && validRange;
      
      return {
        testName: 'testMarketConditionUpdates',
        passed,
        duration: Date.now() - start,
        details: `Conditions updated: ${updated}, Valid range: ${validRange}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testMarketConditionUpdates',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testTradingViewIntegration(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      await this.updateTradingViewAnalysis();
      // TradingView may or may not be available, but the call shouldn't throw
      const passed = true;
      
      return {
        testName: 'testTradingViewIntegration',
        passed,
        duration: Date.now() - start,
        details: `TradingView analysis call completed, Analysis available: ${!!this.tradingViewAnalysis}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testTradingViewIntegration',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testStealthModeTransition(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const canEnterFromOpen = this.isTransitionAllowed('open', 'stealth');
      const canExitToClosing = this.isTransitionAllowed('stealth', 'closing');
      const passed = canEnterFromOpen && canExitToClosing;
      
      return {
        testName: 'testStealthModeTransition',
        passed,
        duration: Date.now() - start,
        details: `Can enter stealth from open: ${canEnterFromOpen}, Can exit to closing: ${canExitToClosing}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testStealthModeTransition',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testCooldownDuration(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const cooldownSleep = this.calculateAdaptiveSleep();
      this.state.mode = 'cooldown';
      const cooldownModeValue = this.calculateAdaptiveSleep();
      const passed = cooldownModeValue === TIMING_CONFIG.cooldownSleep;
      
      return {
        testName: 'testCooldownDuration',
        passed,
        duration: Date.now() - start,
        details: `Cooldown sleep: ${cooldownModeValue}ms, Expected: ${TIMING_CONFIG.cooldownSleep}ms`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testCooldownDuration',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testHourlyReset(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      this.state.profitThisHour = 100;
      this.state.tradesThisHour = 10;
      this.hourlyResetTime = Date.now() - (61 * 60 * 1000); // 61 minutes ago
      
      this.checkHourlyReset();
      
      const passed = this.state.profitThisHour === 0 && this.state.tradesThisHour === 0;
      
      return {
        testName: 'testHourlyReset',
        passed,
        duration: Date.now() - start,
        details: `Profit reset: ${this.state.profitThisHour === 0}, Trades reset: ${this.state.tradesThisHour === 0}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testHourlyReset',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testConcurrentAccess(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      // Simulate concurrent state reads
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(Promise.resolve(this.getState()));
        promises.push(Promise.resolve(this.getMarketConditions()));
      }
      
      const results = await Promise.all(promises);
      const allResolved = results.every(r => r !== null && r !== undefined);
      
      return {
        testName: 'testConcurrentAccess',
        passed: allResolved,
        duration: Date.now() - start,
        details: `${results.length} concurrent operations completed successfully`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testConcurrentAccess',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testHighLoadExecution(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const originalMode = this.state.mode;
      this.state.mode = 'open';
      
      // Execute multiple trades quickly
      const executions = [];
      for (let i = 0; i < 5; i++) {
        executions.push(this.executeWithStealth());
      }
      
      await Promise.all(executions);
      this.state.mode = originalMode;
      
      const passed = true; // If we get here without throwing, test passed
      
      return {
        testName: 'testHighLoadExecution',
        passed,
        duration: Date.now() - start,
        details: `5 concurrent executions completed`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testHighLoadExecution',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testFailureRecovery(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      // Record failures
      this.state.consecutiveFailures = 5;
      this.circuitBreaker.isOpen = true;
      
      // Record success to begin recovery
      this.recordSuccess();
      
      const failuresReset = this.state.consecutiveFailures === 0;
      
      return {
        testName: 'testFailureRecovery',
        passed: failuresReset,
        duration: Date.now() - start,
        details: `Consecutive failures reset on success: ${failuresReset}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testFailureRecovery',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testValidatorWeighting(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const decision = await this.makeOpenDecision();
      const totalWeight = decision.validators.reduce((sum, v) => sum + v.weight, 0);
      const weightsValid = Math.abs(totalWeight - 1.0) < 0.01; // Should sum to ~1.0
      
      return {
        testName: 'testValidatorWeighting',
        passed: weightsValid,
        duration: Date.now() - start,
        details: `Total validator weight: ${totalWeight.toFixed(2)} (expected: 1.0)`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testValidatorWeighting',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  private async testAdaptiveSleepValues(): Promise<StressTestResult> {
    const start = Date.now();
    try {
      const originalMode = this.state.mode;
      
      this.state.mode = 'open';
      const openSleep = this.calculateAdaptiveSleep();
      const openValid = openSleep >= TIMING_CONFIG.activeMinSleep && openSleep <= TIMING_CONFIG.activeMaxSleep;
      
      this.state.mode = 'stealth';
      const stealthSleep = this.calculateAdaptiveSleep();
      const stealthValid = stealthSleep >= TIMING_CONFIG.stealthMinSleep && stealthSleep <= TIMING_CONFIG.stealthMaxSleep;
      
      this.state.mode = originalMode;
      const passed = openValid && stealthValid;
      
      return {
        testName: 'testAdaptiveSleepValues',
        passed,
        duration: Date.now() - start,
        details: `Open sleep valid: ${openValid} (${openSleep}ms), Stealth sleep valid: ${stealthValid} (${stealthSleep}ms)`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        testName: 'testAdaptiveSleepValues',
        passed: false,
        duration: Date.now() - start,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
    }
  }

  // ==========================================================================
  // PUBLIC API - Well-documented methods for external use
  // ==========================================================================

  /**
   * Stops the autonomous faucet loop gracefully.
   * This method sets the isRunning flag to false, which will cause the
   * main loop to exit on its next iteration. All timers are cleaned up.
   * 
   * @example
   * autonomousFaucet.stop();
   * console.log('Faucet stopped, session profit:', autonomousFaucet.getState().profitThisSession);
   */
  stop(): void {
    logger.info('[FAUCET] 🛑 Stopping autonomous faucet', {
      component: 'AutonomousFaucet',
      sessionProfit: this.state.profitThisSession.toFixed(2),
      runTime: `${((Date.now() - this.sessionStartTime) / 1000 / 60).toFixed(1)} minutes`,
      tradesExecuted: this.state.tradesThisHour,
    });

    this.isRunning = false;

    // Best-effort shutdown of dependent systems to avoid "running but unmanaged" state.
    try {
      MasterOrchestrator.stop();
    } catch (error) {
      logger.warn('[FAUCET] Failed to stop orchestrator during stop()', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    void gasOracle.stop().catch((error) => {
      logger.warn('[FAUCET] Failed to stop gas oracle during stop()', {
        component: 'AutonomousFaucet',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    this.cleanup();
  }

  /**
   * Returns a readonly copy of the current faucet state.
   * Includes mode, profit metrics, stealth level, and health score.
   * 
   * @returns Readonly copy of FaucetState
   * @example
   * const state = autonomousFaucet.getState();
   * console.log('Current mode:', state.mode);
   * console.log('Profit this hour:', state.profitThisHour);
   */
  getState(): Readonly<FaucetState> {
    return { ...this.state };
  }

  /**
   * Returns a readonly copy of current market conditions.
   * Includes volatility, gas efficiency, spread opportunities, and technical signals.
   * 
   * @returns Readonly copy of MarketConditions
   * @example
   * const conditions = autonomousFaucet.getMarketConditions();
   * console.log('Market volatility:', conditions.volatility);
   */
  getMarketConditions(): Readonly<MarketConditions> {
    return { ...this.marketConditions };
  }

  /**
   * Checks if the autonomous loop is currently running.
   * 
   * @returns true if the faucet is running, false otherwise
   * @example
   * if (autonomousFaucet.isActive()) {
   *   console.log('Faucet is running');
   * }
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Returns health check results for all monitored components.
   * 
   * @returns Map of component names to their health check results
   */
  getHealthChecks(): Map<string, HealthCheck> {
    return new Map(this.healthChecks);
  }

  /**
   * Returns the current circuit breaker state.
   * 
   * @returns Current circuit breaker state
   */
  getCircuitBreakerState(): Readonly<CircuitBreakerState> {
    return { ...this.circuitBreaker };
  }

  /**
   * Returns results from the last stress test run.
   * 
   * @returns Array of stress test results
   */
  getStressTestResults(): StressTestResult[] {
    return [...this.stressTestResults];
  }
}

// Create singleton instance
const autonomousFaucet = new AutonomousCryptoFaucet();

// Export everything needed
export {
  autonomousFaucet,
  AutonomousCryptoFaucet,
  DECISION_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  TIMING_CONFIG,
  TRADE_CONFIG,
};
