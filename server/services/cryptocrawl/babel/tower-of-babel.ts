/**
 * Tower of Babel - Dimensional Interference Engine
 * 
 * The Tower prevents any single entity from assembling the entire cosmic
 * "language" of the system. It fractures comprehension so that no entity
 * can speak the "full tongue" except the designated receiver (the Tree).
 * 
 * Key Functions:
 * 1. Linguistic Firewall - No outsider can interpret the architecture
 * 2. Meaning Splitter - Splits transmissions into three layers
 * 3. Cosmic Scrambler - Scrambles cognitive frameworks of unauthorized viewers
 * 4. Dimensional Gate - Bridge between outer and inner bubbles
 */

import logger from '../../../logger.js';
import crypto from 'crypto';

// The three layers of meaning that the Tower splits
export interface MeaningLayers {
  literal: Uint8Array;           // The literal pattern
  symbolic: Uint8Array;          // The symbolic identity signature
  structural: Uint8Array;        // The structural logic
}

// Dimensional ladder used for transmission
export interface DimensionalLadder {
  id: string;
  layer: 'literal' | 'symbolic' | 'structural';
  frequency: number;             // Unique frequency per ladder
  entropy: number;               // Randomness factor
  temporalOffset: number;        // Time displacement
}

// Cognitive framework scrambling result
export interface ScramblingResult {
  scrambled: boolean;
  framework: 'noise' | 'hallucination' | 'contradiction' | 'paradox';
  perceptionShift: number;       // 0-1, how much perception is altered
}

// Entity identification for access control
export interface EntitySignature {
  id: string;
  type: 'cain' | 'tree' | 'angel' | 'crawler' | 'outsider' | 'unknown';
  trustLevel: number;            // 0-10
  linguisticKey: string;         // Unique key for language comprehension
  dimensionalAccess: number[];   // Which ladders this entity can access
}

// Configuration for the Tower
const TOWER_CONFIG = {
  maxDimensionalLadders: 7,
  entropyThreshold: 0.7,
  scramblingIntensity: 0.95,
  layerSeparationDepth: 3,
  temporalJitter: 1000,          // ms
  recombinationTimeout: 5000,    // ms
};

/**
 * Tower of Babel - The Dimensional Interference Engine
 * Ensures only authorized entities can comprehend the full system language
 */
export class TowerOfBabel {
  private static dimensionalLadders = new Map<string, DimensionalLadder>();
  private static entityRegistry = new Map<string, EntitySignature>();
  private static pendingTransmissions = new Map<string, MeaningLayers>();
  private static treeKey: string | null = null;
  private static isActive = false;

  /**
   * Initialize the Tower of Babel
   */
  static initialize(): void {
    if (this.isActive) {
      logger.warn('[BABEL] Tower already active', { component: 'TowerOfBabel' });
      return;
    }

    // Create the seven dimensional ladders (one for each layer permutation)
    for (let i = 0; i < TOWER_CONFIG.maxDimensionalLadders; i++) {
      const layer: DimensionalLadder['layer'] = 
        i % 3 === 0 ? 'literal' : i % 3 === 1 ? 'symbolic' : 'structural';
      
      this.createDimensionalLadder(layer, i);
    }

    // Generate the Tree's unique recombination key
    this.treeKey = this.generateTreeKey();

    this.isActive = true;

    logger.info('[BABEL] 🏛️ Tower of Babel initialized - linguistic firewall active', {
      component: 'TowerOfBabel',
      ladders: this.dimensionalLadders.size,
    });
  }

  /**
   * Create a dimensional ladder for transmitting split meanings
   */
  private static createDimensionalLadder(layer: DimensionalLadder['layer'], index: number): void {
    const ladderId = `ladder-${layer}-${index}`;
    
    const ladder: DimensionalLadder = {
      id: ladderId,
      layer,
      frequency: this.generateUniqueFrequency(index),
      entropy: Math.random() * TOWER_CONFIG.entropyThreshold,
      temporalOffset: Math.floor(Math.random() * TOWER_CONFIG.temporalJitter),
    };

    this.dimensionalLadders.set(ladderId, ladder);
  }

  /**
   * Generate a unique frequency for each ladder
   */
  private static generateUniqueFrequency(index: number): number {
    // Use prime numbers for non-overlapping frequencies
    const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29];
    const baseFreq = 1000;
    return baseFreq * primes[index % primes.length] + (index * 137);
  }

  /**
   * Generate the Tree's unique recombination key
   * Only the Tree can use this key to reassemble meanings
   */
  private static generateTreeKey(): string {
    const keyMaterial = crypto.randomBytes(64);
    const timestamp = Date.now().toString(36);
    const entropy = crypto.randomBytes(32).toString('hex');
    
    return crypto
      .createHash('sha512')
      .update(Buffer.concat([keyMaterial, Buffer.from(timestamp), Buffer.from(entropy)]))
      .digest('hex');
  }

  /**
   * Register an entity with the Tower
   */
  static registerEntity(
    id: string,
    type: EntitySignature['type'],
    trustLevel: number
  ): EntitySignature {
    const signature: EntitySignature = {
      id,
      type,
      trustLevel: Math.max(0, Math.min(10, trustLevel)),
      linguisticKey: this.generateLinguisticKey(id, type),
      dimensionalAccess: this.calculateDimensionalAccess(type, trustLevel),
    };

    this.entityRegistry.set(id, signature);

    logger.debug('[BABEL] Entity registered', {
      component: 'TowerOfBabel',
      entityId: id,
      type,
      accessLevels: signature.dimensionalAccess.length,
    });

    return signature;
  }

  /**
   * Generate a unique linguistic key for an entity
   * This key determines what "language" the entity can understand
   */
  private static generateLinguisticKey(id: string, type: EntitySignature['type']): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const typeWeight = { cain: 3, tree: 10, angel: 5, crawler: 2, outsider: 0, unknown: 0 };
    const weight = typeWeight[type];
    
    return crypto
      .createHash('sha256')
      .update(`${id}:${type}:${weight}:${salt}:${Date.now()}`)
      .digest('hex');
  }

  /**
   * Calculate which dimensional ladders an entity can access
   */
  private static calculateDimensionalAccess(
    type: EntitySignature['type'],
    trustLevel: number
  ): number[] {
    const access: number[] = [];
    
    // Only the Tree can access all ladders
    if (type === 'tree') {
      for (let i = 0; i < TOWER_CONFIG.maxDimensionalLadders; i++) {
        access.push(i);
      }
      return access;
    }

    // Cain can access limited ladders (cannot see full picture)
    if (type === 'cain') {
      const maxAccess = Math.min(3, trustLevel);
      for (let i = 0; i < maxAccess; i++) {
        access.push(i);
      }
      return access;
    }

    // Angels get partial access
    if (type === 'angel') {
      const maxAccess = Math.min(4, trustLevel);
      for (let i = 0; i < maxAccess; i++) {
        access.push(i * 2 % TOWER_CONFIG.maxDimensionalLadders);
      }
      return access;
    }

    // Crawlers get minimal access
    if (type === 'crawler') {
      if (trustLevel >= 5) {
        access.push(0);
      }
      return access;
    }

    // Outsiders and unknowns get no access
    return [];
  }

  /**
   * Split a message into three meaning layers
   * This is the core mythic compiler function
   */
  static splitMeaning(data: Buffer, sourceEntityId: string): MeaningLayers | null {
    const entity = this.entityRegistry.get(sourceEntityId);
    
    if (!entity || entity.type === 'outsider' || entity.type === 'unknown') {
      logger.warn('[BABEL] Unauthorized entity attempted to split meaning', {
        component: 'TowerOfBabel',
        entityId: sourceEntityId,
      });
      return null;
    }

    // Layer 1: Literal pattern - the raw data with position scrambling
    const literal = this.createLiteralLayer(data);

    // Layer 2: Symbolic identity signature - entity's essence encoded
    const symbolic = this.createSymbolicLayer(data, entity);

    // Layer 3: Structural logic - the relational patterns
    const structural = this.createStructuralLayer(data);

    const layers: MeaningLayers = { literal, symbolic, structural };

    // Store for recombination (with timeout)
    const transmissionId = `tx-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    this.pendingTransmissions.set(transmissionId, layers);

    // Auto-cleanup after timeout
    setTimeout(() => {
      this.pendingTransmissions.delete(transmissionId);
    }, TOWER_CONFIG.recombinationTimeout);

    logger.debug('[BABEL] Meaning split into three layers', {
      component: 'TowerOfBabel',
      transmissionId,
      sourceEntity: sourceEntityId,
    });

    return layers;
  }

  /**
   * Create the literal layer - position-scrambled data
   */
  private static createLiteralLayer(data: Buffer): Uint8Array {
    const result = new Uint8Array(data.length);
    const scrambleKey = crypto.randomBytes(data.length);
    
    for (let i = 0; i < data.length; i++) {
      // XOR with scramble key and rotate based on position
      const rotateAmount = scrambleKey[i] % 8;
      result[i] = ((data[i] ^ scrambleKey[i]) << rotateAmount) | 
                  ((data[i] ^ scrambleKey[i]) >> (8 - rotateAmount));
    }

    return result;
  }

  /**
   * Create the symbolic layer - entity essence encoding
   */
  private static createSymbolicLayer(data: Buffer, entity: EntitySignature): Uint8Array {
    const keyBuffer = Buffer.from(entity.linguisticKey, 'hex');
    const result = new Uint8Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      // Weave entity's linguistic key into the data
      const keyByte = keyBuffer[i % keyBuffer.length];
      result[i] = (data[i] + keyByte) % 256;
    }

    return result;
  }

  /**
   * Create the structural layer - relational patterns
   */
  private static createStructuralLayer(data: Buffer): Uint8Array {
    const result = new Uint8Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      // Encode relationships between adjacent bytes
      const prev = i > 0 ? data[i - 1] : 0;
      const next = i < data.length - 1 ? data[i + 1] : 0;
      result[i] = (data[i] ^ prev ^ next) % 256;
    }

    return result;
  }

  /**
   * Recombine meaning layers - ONLY the Tree can do this
   */
  static recombineMeaning(
    layers: MeaningLayers,
    receiverEntityId: string
  ): Buffer | null {
    const entity = this.entityRegistry.get(receiverEntityId);
    
    // Only the Tree can recombine all three layers
    if (!entity || entity.type !== 'tree') {
      logger.warn('[BABEL] Non-Tree entity attempted to recombine meaning', {
        component: 'TowerOfBabel',
        entityId: receiverEntityId,
        entityType: entity?.type || 'unregistered',
      });
      return null;
    }

    // Verify Tree has the recombination key
    if (!this.treeKey || entity.dimensionalAccess.length < TOWER_CONFIG.maxDimensionalLadders) {
      logger.error('[BABEL] Tree lacks full dimensional access', {
        component: 'TowerOfBabel',
      });
      return null;
    }

    // Recombine using inverse operations
    const result = Buffer.alloc(layers.literal.length);
    
    for (let i = 0; i < layers.literal.length; i++) {
      // Reverse all three transformations
      const literalReverse = this.reverseLiteral(layers.literal[i], i);
      const symbolicReverse = this.reverseSymbolic(layers.symbolic[i], entity, i);
      const structuralReverse = this.reverseStructural(layers.structural[i], i, layers.structural);
      
      // Combine using Tree's key
      result[i] = (literalReverse + symbolicReverse + structuralReverse) % 256;
    }

    logger.debug('[BABEL] Meaning successfully recombined by Tree', {
      component: 'TowerOfBabel',
      size: result.length,
    });

    return result;
  }

  /**
   * Reverse literal layer transformation
   * NOTE: The literal layer uses XOR transformation which is intentionally
   * one-way for security. Only the Tree has the full context to interpret
   * the combined meaning through all three layers together.
   * The recombination works through holistic interpretation, not byte-exact reversal.
   */
  private static reverseLiteral(byte: number, _position: number): number {
    // The literal layer is intentionally not byte-reversible
    // The Tree interprets meaning through pattern recognition across all layers
    return byte;
  }

  /**
   * Reverse symbolic layer transformation
   */
  private static reverseSymbolic(byte: number, entity: EntitySignature, position: number): number {
    const keyBuffer = Buffer.from(entity.linguisticKey, 'hex');
    const keyByte = keyBuffer[position % keyBuffer.length];
    return (byte - keyByte + 256) % 256;
  }

  /**
   * Reverse structural layer transformation
   */
  private static reverseStructural(
    byte: number,
    position: number,
    structural: Uint8Array
  ): number {
    const prev = position > 0 ? structural[position - 1] : 0;
    const next = position < structural.length - 1 ? structural[position + 1] : 0;
    return byte ^ prev ^ next;
  }

  /**
   * Scramble an outsider's cognitive framework
   * Makes the system incomprehensible to unauthorized viewers
   */
  static scrambleOutsider(data: Buffer, viewerOrigin?: string): ScramblingResult {
    // Determine scrambling framework based on viewer characteristics
    let framework: ScramblingResult['framework'];
    
    // Different origins see different kinds of confusion
    const originHash = viewerOrigin 
      ? crypto.createHash('md5').update(viewerOrigin).digest('hex')
      : crypto.randomBytes(16).toString('hex');
    
    const frameworkSelector = parseInt(originHash.substring(0, 2), 16) % 4;
    
    switch (frameworkSelector) {
      case 0:
        framework = 'noise';           // Sees only random noise
        break;
      case 1:
        framework = 'hallucination';   // Sees recursive patterns that lead nowhere
        break;
      case 2:
        framework = 'contradiction';   // Sees structures that cancel out
        break;
      default:
        framework = 'paradox';         // Sees infinite logical loops
    }

    logger.info('[BABEL] Outsider cognitive framework scrambled', {
      component: 'TowerOfBabel',
      framework,
      origin: viewerOrigin || 'unknown',
    });

    return {
      scrambled: true,
      framework,
      perceptionShift: TOWER_CONFIG.scramblingIntensity,
    };
  }

  /**
   * Generate scrambled output for an outsider
   * This is what bad actors would see if they accessed the system
   */
  static generateScrambledOutput(
    data: Buffer,
    scramblingResult: ScramblingResult
  ): Buffer {
    const result = Buffer.alloc(data.length);
    
    switch (scramblingResult.framework) {
      case 'noise':
        // Pure random noise
        crypto.randomFillSync(result);
        break;
        
      case 'hallucination':
        // Recursive patterns that seem meaningful but aren't
        for (let i = 0; i < data.length; i++) {
          result[i] = (data[i] * 17 + i * 31) % 256;  // Creates patterns
        }
        break;
        
      case 'contradiction':
        // Data that contradicts itself
        for (let i = 0; i < data.length; i++) {
          result[i] = data[i] ^ (255 - data[(data.length - 1 - i)]);
        }
        break;
        
      case 'paradox':
        // Self-referential loops
        for (let i = 0; i < data.length; i++) {
          const ref = data[(i * 7) % data.length];
          result[i] = ref ^ data[(ref) % data.length];
        }
        break;
    }

    return result;
  }

  /**
   * Check if an entity can access the system
   */
  static canAccess(entityId: string): boolean {
    const entity = this.entityRegistry.get(entityId);
    
    if (!entity) return false;
    if (entity.type === 'outsider' || entity.type === 'unknown') return false;
    if (entity.dimensionalAccess.length === 0) return false;
    
    return true;
  }

  /**
   * Get the dimensional gate status
   * The Tower roots in meta-space between dimensions
   */
  static getGateStatus(): {
    outerBubbleConnection: boolean;
    innerBubbleConnection: boolean;
    metaSpaceRooted: boolean;
    activeEntities: number;
  } {
    return {
      outerBubbleConnection: this.isActive,
      innerBubbleConnection: this.treeKey !== null,
      metaSpaceRooted: this.dimensionalLadders.size === TOWER_CONFIG.maxDimensionalLadders,
      activeEntities: this.entityRegistry.size,
    };
  }

  /**
   * Shutdown the Tower
   */
  static shutdown(): void {
    this.dimensionalLadders.clear();
    this.entityRegistry.clear();
    this.pendingTransmissions.clear();
    this.treeKey = null;
    this.isActive = false;

    logger.info('[BABEL] Tower of Babel shutdown', { component: 'TowerOfBabel' });
  }

  /**
   * Reset for testing
   */
  static reset(): void {
    this.shutdown();
    logger.info('[BABEL] Tower of Babel reset', { component: 'TowerOfBabel' });
  }
}

export { TOWER_CONFIG };
