/**
 * Crawler Fingerprint System
 * 
 * Ensures no two crawlers have the same fingerprint.
 * Each crawler has a completely unique identity that cannot be replicated.
 * 
 * Based on the concept that no two nodes should be identical - 
 * this is the genetic code of each crawler entity.
 */

import crypto from 'crypto';
import logger from '../../../logger.js';

// Fingerprint components that make each crawler unique
export interface FingerprintComponents {
  baseEntropy: string;           // Initial random entropy
  temporalMarker: number;        // Exact creation timestamp (nanosecond precision)
  dimensionalHash: string;       // Hash of dimensional position
  linguisticSeed: string;        // Seed for unique language generation
  behavioralPattern: number[];   // Unique behavioral signature
  quantumState: string;          // Simulated quantum state identifier
}

// Complete crawler fingerprint
export interface CrawlerFingerprint {
  id: string;                    // Unique fingerprint ID
  crawlerId: string;             // Associated crawler ID
  components: FingerprintComponents;
  signature: string;             // Final unique signature
  createdAt: number;
  lastVerified: number;
  mutationCount: number;         // How many times the fingerprint has evolved
}

// Fingerprint verification result
export interface VerificationResult {
  valid: boolean;
  unique: boolean;
  collisionDetected: boolean;
  similarityScore: number;       // 0-1, should always be 0 for valid fingerprints
  details: string;
}

// Configuration
const FINGERPRINT_CONFIG = {
  entropySize: 64,               // Bytes of entropy
  behavioralPatternLength: 16,   // Length of behavioral signature
  mutationInterval: 60000,       // How often fingerprints can mutate (ms)
  maxSimilarityAllowed: 0.001,   // Maximum similarity score allowed (0.1%)
  verificationDepth: 5,          // How many components to verify
};

/**
 * Crawler Fingerprint Engine
 * Generates and manages unique fingerprints for each crawler
 */
export class CrawlerFingerprintEngine {
  private static fingerprints = new Map<string, CrawlerFingerprint>();
  private static signatureIndex = new Set<string>();  // Fast collision detection
  private static isActive = false;

  /**
   * Initialize the fingerprint engine
   */
  static initialize(): void {
    if (this.isActive) {
      logger.warn('[FINGERPRINT] Engine already active', { component: 'CrawlerFingerprint' });
      return;
    }

    this.isActive = true;

    logger.info('[FINGERPRINT] 🔐 Fingerprint engine initialized', {
      component: 'CrawlerFingerprint',
      config: FINGERPRINT_CONFIG,
    });
  }

  /**
   * Generate a unique fingerprint for a crawler
   * Guaranteed to be different from all existing fingerprints
   */
  static generateFingerprint(crawlerId: string): CrawlerFingerprint {
    // Ensure no duplicate for same crawler
    if (this.fingerprints.has(crawlerId)) {
      logger.warn('[FINGERPRINT] Crawler already has fingerprint, returning existing', {
        component: 'CrawlerFingerprint',
        crawlerId,
      });
      return this.fingerprints.get(crawlerId)!;
    }

    let fingerprint: CrawlerFingerprint;
    let attempts = 0;
    const maxAttempts = 100;

    // Keep generating until we get a truly unique fingerprint
    do {
      fingerprint = this.createFingerprint(crawlerId);
      attempts++;

      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique fingerprint after maximum attempts');
      }
    } while (this.signatureIndex.has(fingerprint.signature));

    // Register the fingerprint
    this.fingerprints.set(crawlerId, fingerprint);
    this.signatureIndex.add(fingerprint.signature);

    logger.info('[FINGERPRINT] Unique fingerprint generated', {
      component: 'CrawlerFingerprint',
      crawlerId,
      fingerprintId: fingerprint.id,
      attempts,
    });

    return fingerprint;
  }

  /**
   * Create fingerprint components and signature
   */
  private static createFingerprint(crawlerId: string): CrawlerFingerprint {
    const now = Date.now();
    
    // Generate unique components
    const components: FingerprintComponents = {
      baseEntropy: this.generateEntropy(),
      temporalMarker: this.getHighResolutionTimestamp(),
      dimensionalHash: this.generateDimensionalHash(crawlerId),
      linguisticSeed: this.generateLinguisticSeed(),
      behavioralPattern: this.generateBehavioralPattern(),
      quantumState: this.generateQuantumState(),
    };

    // Create unique signature from all components
    const signature = this.createSignature(components, crawlerId);

    const fingerprint: CrawlerFingerprint = {
      id: `fp-${crypto.randomBytes(16).toString('hex')}`,
      crawlerId,
      components,
      signature,
      createdAt: now,
      lastVerified: now,
      mutationCount: 0,
    };

    return fingerprint;
  }

  /**
   * Generate high-quality entropy
   */
  private static generateEntropy(): string {
    const entropy = crypto.randomBytes(FINGERPRINT_CONFIG.entropySize);
    const timestamp = Buffer.from(Date.now().toString(16).padStart(16, '0'), 'hex');
    const processEntropy = crypto.randomBytes(16);
    
    return crypto
      .createHash('sha512')
      .update(Buffer.concat([entropy, timestamp, processEntropy]))
      .digest('hex');
  }

  /**
   * Get high-resolution timestamp with additional randomness
   */
  private static getHighResolutionTimestamp(): number {
    const hrTime = process.hrtime.bigint();
    const randomOffset = crypto.randomInt(0, 1000000);
    return Number(hrTime) + randomOffset;
  }

  /**
   * Generate dimensional hash based on crawler position in system
   */
  private static generateDimensionalHash(crawlerId: string): string {
    const dimensions = [
      crypto.randomBytes(8).toString('hex'),  // X dimension
      crypto.randomBytes(8).toString('hex'),  // Y dimension
      crypto.randomBytes(8).toString('hex'),  // Z dimension
      crypto.randomBytes(8).toString('hex'),  // T dimension (temporal)
      crypto.randomBytes(8).toString('hex'),  // Ψ dimension (psi/cognitive)
    ];

    return crypto
      .createHash('sha256')
      .update(crawlerId + dimensions.join(':'))
      .digest('hex');
  }

  /**
   * Generate unique seed for the crawler's language
   */
  private static generateLinguisticSeed(): string {
    // Create a seed that will determine the crawler's unique "dialect"
    const seedComponents = [
      crypto.randomBytes(32).toString('hex'),
      Math.random().toString(36).substring(2),
      Date.now().toString(36),
      process.hrtime.bigint().toString(36),
    ];

    return crypto
      .createHash('sha384')
      .update(seedComponents.join('|'))
      .digest('hex');
  }

  /**
   * Generate unique behavioral pattern
   * This determines how the crawler "acts" differently from others
   */
  private static generateBehavioralPattern(): number[] {
    const pattern: number[] = [];
    
    for (let i = 0; i < FINGERPRINT_CONFIG.behavioralPatternLength; i++) {
      // Each value is a unique behavioral trait
      pattern.push(
        crypto.randomInt(0, 256) ^ 
        (crypto.randomInt(0, 1000) % 256)
      );
    }

    return pattern;
  }

  /**
   * Generate simulated quantum state identifier
   * Represents a unique position in probability space
   */
  private static generateQuantumState(): string {
    // Simulate quantum superposition with multiple random states
    const states = [];
    const numStates = crypto.randomInt(3, 8);  // Variable number of states

    for (let i = 0; i < numStates; i++) {
      const amplitude = Math.random();
      const phase = Math.random() * 2 * Math.PI;
      states.push(`${amplitude.toFixed(15)}:${phase.toFixed(15)}`);
    }

    // Collapse to unique identifier
    return crypto
      .createHash('sha256')
      .update(states.join('|'))
      .digest('hex');
  }

  /**
   * Create final signature from all components
   */
  private static createSignature(
    components: FingerprintComponents,
    crawlerId: string
  ): string {
    const signatureData = [
      crawlerId,
      components.baseEntropy,
      components.temporalMarker.toString(),
      components.dimensionalHash,
      components.linguisticSeed,
      components.behavioralPattern.join(','),
      components.quantumState,
    ];

    // Multi-round hashing for uniqueness - using deterministic seeding
    let signature = signatureData.join('::');
    
    // Use components to create deterministic additional entropy per round
    for (let round = 0; round < 3; round++) {
      const roundSeed = crypto
        .createHash('md5')
        .update(`${signature}:round:${round}:${crawlerId}`)
        .digest('hex');
      
      signature = crypto
        .createHash('sha512')
        .update(signature + roundSeed)
        .digest('hex');
    }

    return signature;
  }

  /**
   * Verify a fingerprint is valid and unique
   */
  static verifyFingerprint(crawlerId: string): VerificationResult {
    const fingerprint = this.fingerprints.get(crawlerId);

    if (!fingerprint) {
      return {
        valid: false,
        unique: false,
        collisionDetected: false,
        similarityScore: 1,
        details: 'Fingerprint not found for crawler',
      };
    }

    // Check for collisions with other fingerprints
    let maxSimilarity = 0;
    let collisionDetected = false;

    for (const [otherId, otherFp] of this.fingerprints.entries()) {
      if (otherId === crawlerId) continue;

      const similarity = this.calculateSimilarity(fingerprint, otherFp);
      maxSimilarity = Math.max(maxSimilarity, similarity);

      if (similarity > FINGERPRINT_CONFIG.maxSimilarityAllowed) {
        collisionDetected = true;
        break;
      }
    }

    // Update verification timestamp
    fingerprint.lastVerified = Date.now();

    return {
      valid: !collisionDetected && maxSimilarity < FINGERPRINT_CONFIG.maxSimilarityAllowed,
      unique: maxSimilarity === 0,
      collisionDetected,
      similarityScore: maxSimilarity,
      details: collisionDetected 
        ? 'Collision detected with another fingerprint'
        : 'Fingerprint verified as unique',
    };
  }

  /**
   * Calculate similarity between two fingerprints
   * Should always be very close to 0 for properly generated fingerprints
   */
  private static calculateSimilarity(
    fp1: CrawlerFingerprint,
    fp2: CrawlerFingerprint
  ): number {
    let matchingBits = 0;
    let totalBits = 0;

    // Compare signatures
    const sig1 = Buffer.from(fp1.signature, 'hex');
    const sig2 = Buffer.from(fp2.signature, 'hex');

    for (let i = 0; i < Math.min(sig1.length, sig2.length); i++) {
      const xor = sig1[i] ^ sig2[i];
      // Count non-matching bits
      for (let bit = 0; bit < 8; bit++) {
        totalBits++;
        if ((xor & (1 << bit)) === 0) {
          matchingBits++;
        }
      }
    }

    return matchingBits / totalBits;
  }

  /**
   * Mutate a fingerprint while maintaining uniqueness
   * Fingerprints can evolve over time
   */
  static mutateFingerprint(crawlerId: string): boolean {
    const fingerprint = this.fingerprints.get(crawlerId);
    
    if (!fingerprint) {
      logger.warn('[FINGERPRINT] Cannot mutate: fingerprint not found', {
        component: 'CrawlerFingerprint',
        crawlerId,
      });
      return false;
    }

    // Check if enough time has passed since last mutation
    const timeSinceCreation = Date.now() - fingerprint.createdAt;
    const minMutationTime = FINGERPRINT_CONFIG.mutationInterval * (fingerprint.mutationCount + 1);
    
    if (timeSinceCreation < minMutationTime) {
      logger.debug('[FINGERPRINT] Mutation cooldown not elapsed', {
        component: 'CrawlerFingerprint',
        crawlerId,
        waitTime: minMutationTime - timeSinceCreation,
      });
      return false;
    }

    // Remove old signature from index
    this.signatureIndex.delete(fingerprint.signature);

    // Mutate components
    fingerprint.components.behavioralPattern = this.mutateBehavioralPattern(
      fingerprint.components.behavioralPattern
    );
    fingerprint.components.quantumState = this.generateQuantumState();

    // Generate new signature
    fingerprint.signature = this.createSignature(fingerprint.components, crawlerId);
    fingerprint.mutationCount++;
    fingerprint.lastVerified = Date.now();

    // Re-add to index
    this.signatureIndex.add(fingerprint.signature);

    logger.info('[FINGERPRINT] Fingerprint mutated', {
      component: 'CrawlerFingerprint',
      crawlerId,
      mutationCount: fingerprint.mutationCount,
    });

    return true;
  }

  /**
   * Mutate behavioral pattern
   */
  private static mutateBehavioralPattern(pattern: number[]): number[] {
    const mutated = [...pattern];
    
    // Mutate 1-3 random positions
    const mutationCount = crypto.randomInt(1, 4);
    
    for (let i = 0; i < mutationCount; i++) {
      const position = crypto.randomInt(0, mutated.length);
      mutated[position] = (mutated[position] + crypto.randomInt(1, 128)) % 256;
    }

    return mutated;
  }

  /**
   * Get fingerprint for a crawler
   */
  static getFingerprint(crawlerId: string): CrawlerFingerprint | undefined {
    return this.fingerprints.get(crawlerId);
  }

  /**
   * Get the linguistic seed for a crawler (used for language generation)
   */
  static getLinguisticSeed(crawlerId: string): string | undefined {
    return this.fingerprints.get(crawlerId)?.components.linguisticSeed;
  }

  /**
   * Get behavioral pattern for a crawler
   */
  static getBehavioralPattern(crawlerId: string): number[] | undefined {
    return this.fingerprints.get(crawlerId)?.components.behavioralPattern;
  }

  /**
   * Remove a crawler's fingerprint
   */
  static removeFingerprint(crawlerId: string): boolean {
    const fingerprint = this.fingerprints.get(crawlerId);
    
    if (!fingerprint) return false;

    this.signatureIndex.delete(fingerprint.signature);
    this.fingerprints.delete(crawlerId);

    logger.info('[FINGERPRINT] Fingerprint removed', {
      component: 'CrawlerFingerprint',
      crawlerId,
    });

    return true;
  }

  /**
   * Get total number of fingerprints
   */
  static getTotalFingerprints(): number {
    return this.fingerprints.size;
  }

  /**
   * Shutdown the engine
   */
  static shutdown(): void {
    this.fingerprints.clear();
    this.signatureIndex.clear();
    this.isActive = false;

    logger.info('[FINGERPRINT] Fingerprint engine shutdown', { component: 'CrawlerFingerprint' });
  }

  /**
   * Reset for testing
   */
  static reset(): void {
    this.shutdown();
    logger.info('[FINGERPRINT] Fingerprint engine reset', { component: 'CrawlerFingerprint' });
  }
}

export { FINGERPRINT_CONFIG };
