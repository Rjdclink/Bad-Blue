/**
 * Light Language System
 * 
 * No two nodes or crawlers speak the same language, other than Light Language,
 * which is a universal metalanguage understood by all but expressed differently
 * by each entity.
 * 
 * Each crawler has its own unique dialect generated from its fingerprint.
 * When crawlers communicate, they translate through Light Language -
 * a symbolic, ethereal medium that transcends individual dialects.
 */

import crypto from 'crypto';
import logger from '../../../logger.js';
import { CrawlerFingerprintEngine } from './crawler-fingerprint';

// A word in a crawler's unique dialect
export interface DialectWord {
  symbol: string;              // The unique symbol for this word
  meaning: number;             // Numeric meaning (0-65535)
  frequency: number;           // How often this word is used
  emotionalWeight: number;     // -1 to 1, emotional connotation
}

// A crawler's complete dialect
export interface CrawlerDialect {
  crawlerId: string;
  seed: string;                // Derived from fingerprint
  vocabulary: Map<number, DialectWord>;
  grammarRules: GrammarRule[];
  phonemeSet: string[];        // Unique sounds/symbols
  createdAt: number;
}

// Grammar rules unique to each dialect
export interface GrammarRule {
  id: string;
  pattern: string;             // Pattern to match
  transform: string;           // Transformation to apply
  priority: number;
}

// A message in Light Language (universal)
export interface LightMessage {
  id: string;
  sourceDialect: string;       // Source crawler ID
  targetDialect: string;       // Target crawler ID (or 'broadcast')
  lightSymbols: number[];      // Universal light symbols
  timestamp: number;
  intensity: number;           // Message importance (0-1)
  wavelength: number;          // Color/frequency of light
}

// Translated message in a specific dialect
export interface DialectMessage {
  originalLight: LightMessage;
  translatedSymbols: string[];
  confidence: number;          // Translation confidence (0-1)
  lostInTranslation: number;   // How much meaning was lost (0-1)
}

// Light Language configuration
const LIGHT_LANGUAGE_CONFIG = {
  vocabularySize: 1024,        // Words per dialect
  phonemeCount: 64,            // Unique phonemes per dialect
  grammarRulesCount: 32,       // Grammar rules per dialect
  lightSpectrumRange: 1000,    // Range of light wavelengths
  maxMessageLength: 256,       // Max symbols per message
  translationAccuracy: 0.95,   // Base translation accuracy
};

/**
 * Light Language Engine
 * Manages unique dialects and universal Light Language translation
 */
export class LightLanguageEngine {
  private static dialects = new Map<string, CrawlerDialect>();
  private static lightMessageLog: LightMessage[] = [];
  private static maxLogSize = 10000;
  private static isActive = false;

  // Universal Light Language symbols (shared by all)
  private static readonly LIGHT_SYMBOLS = {
    // Emotional states
    HARMONY: 0x0001,
    DISCORD: 0x0002,
    CURIOSITY: 0x0003,
    FEAR: 0x0004,
    
    // Actions
    OBSERVE: 0x0010,
    EXECUTE: 0x0011,
    WAIT: 0x0012,
    RETREAT: 0x0013,
    
    // States
    READY: 0x0020,
    BUSY: 0x0021,
    ERROR: 0x0022,
    SUCCESS: 0x0023,
    
    // Coordination
    SYNC: 0x0030,
    SPLIT: 0x0031,
    MERGE: 0x0032,
    HANDOFF: 0x0033,
    
    // Alerts
    OPPORTUNITY: 0x0040,
    DANGER: 0x0041,
    COMPETITION: 0x0042,
    PROFIT: 0x0043,
  };

  /**
   * Initialize the Light Language engine
   */
  static initialize(): void {
    if (this.isActive) {
      logger.warn('[LIGHT-LANG] Engine already active', { component: 'LightLanguage' });
      return;
    }

    this.isActive = true;

    logger.info('[LIGHT-LANG] ✨ Light Language engine initialized', {
      component: 'LightLanguage',
      universalSymbols: Object.keys(this.LIGHT_SYMBOLS).length,
    });
  }

  /**
   * Generate a unique dialect for a crawler
   */
  static generateDialect(crawlerId: string): CrawlerDialect {
    // Check if dialect already exists
    if (this.dialects.has(crawlerId)) {
      return this.dialects.get(crawlerId)!;
    }

    // Get linguistic seed from fingerprint
    const seed = CrawlerFingerprintEngine.getLinguisticSeed(crawlerId);
    
    if (!seed) {
      throw new Error(`Crawler ${crawlerId} must have a fingerprint before generating dialect`);
    }

    // Generate unique vocabulary
    const vocabulary = this.generateVocabulary(seed);

    // Generate unique grammar rules
    const grammarRules = this.generateGrammarRules(seed);

    // Generate unique phoneme set
    const phonemeSet = this.generatePhonemeSet(seed);

    const dialect: CrawlerDialect = {
      crawlerId,
      seed,
      vocabulary,
      grammarRules,
      phonemeSet,
      createdAt: Date.now(),
    };

    this.dialects.set(crawlerId, dialect);

    logger.info('[LIGHT-LANG] Unique dialect generated', {
      component: 'LightLanguage',
      crawlerId,
      vocabularySize: vocabulary.size,
      grammarRules: grammarRules.length,
      phonemes: phonemeSet.length,
    });

    return dialect;
  }

  /**
   * Generate unique vocabulary from seed
   */
  private static generateVocabulary(seed: string): Map<number, DialectWord> {
    const vocabulary = new Map<number, DialectWord>();
    const seedBuffer = Buffer.from(seed, 'hex');

    for (let i = 0; i < LIGHT_LANGUAGE_CONFIG.vocabularySize; i++) {
      // Generate unique symbol for this word
      const symbolSeed = crypto
        .createHash('sha256')
        .update(seedBuffer)
        .update(Buffer.from(i.toString()))
        .digest();

      const symbol = this.generateUniqueSymbol(symbolSeed, i);

      const word: DialectWord = {
        symbol,
        meaning: i,
        frequency: Math.pow(Math.random(), 2), // Zipf-like distribution
        emotionalWeight: (symbolSeed[0] / 127.5) - 1, // -1 to 1
      };

      vocabulary.set(i, word);
    }

    return vocabulary;
  }

  /**
   * Generate a unique symbol from seed
   */
  private static generateUniqueSymbol(seedBuffer: Buffer, index: number): string {
    // Create a unique symbol using multiple character sets
    const unicodeRanges = [
      [0x0391, 0x03C9], // Greek
      [0x0410, 0x044F], // Cyrillic
      [0x05D0, 0x05EA], // Hebrew
      [0x0621, 0x064A], // Arabic
      [0x4E00, 0x4FFF], // CJK
      [0x2200, 0x22FF], // Mathematical
      [0x2600, 0x26FF], // Miscellaneous symbols
    ];

    let symbol = '';
    const symbolLength = (seedBuffer[0] % 3) + 1; // 1-3 characters

    for (let i = 0; i < symbolLength; i++) {
      const rangeIndex = (seedBuffer[i + 1] + index) % unicodeRanges.length;
      const range = unicodeRanges[rangeIndex];
      const charCode = range[0] + (seedBuffer[i + 2] % (range[1] - range[0]));
      symbol += String.fromCharCode(charCode);
    }

    return symbol;
  }

  /**
   * Generate unique grammar rules from seed
   */
  private static generateGrammarRules(seed: string): GrammarRule[] {
    const rules: GrammarRule[] = [];
    const seedHash = crypto.createHash('md5').update(seed).digest('hex');

    for (let i = 0; i < LIGHT_LANGUAGE_CONFIG.grammarRulesCount; i++) {
      const ruleSeed = parseInt(seedHash.substring(i % 24, (i % 24) + 8), 16);

      rules.push({
        id: `rule-${i}`,
        pattern: this.generateGrammarPattern(ruleSeed, i),
        transform: this.generateGrammarTransform(ruleSeed, i),
        priority: ruleSeed % 100,
      });
    }

    // Sort by priority
    rules.sort((a, b) => b.priority - a.priority);

    return rules;
  }

  /**
   * Generate grammar pattern
   */
  private static generateGrammarPattern(seed: number, index: number): string {
    const patterns = [
      'S -> NP VP',
      'NP -> Det N',
      'VP -> V NP',
      'S -> S Conj S',
      'NP -> N',
      'VP -> V',
    ];

    return patterns[(seed + index) % patterns.length] + `_${seed % 100}`;
  }

  /**
   * Generate grammar transform
   */
  private static generateGrammarTransform(seed: number, index: number): string {
    const transforms = [
      'prefix',
      'suffix',
      'infix',
      'reduplication',
      'ablaut',
      'suppletion',
    ];

    return transforms[(seed * index) % transforms.length] + `_${(seed + index) % 50}`;
  }

  /**
   * Generate unique phoneme set from seed
   */
  private static generatePhonemeSet(seed: string): string[] {
    const phonemes: string[] = [];
    const seedBuffer = Buffer.from(seed, 'hex');

    // IPA-like phoneme categories
    const consonants = 'pbtdkgmnŋfvszʃʒxhljwr'.split('');
    const vowels = 'aeiouæøœɑɔɛɪʊ'.split('');
    const modifiers = '̃́̀ʰʷ'.split('');

    for (let i = 0; i < LIGHT_LANGUAGE_CONFIG.phonemeCount; i++) {
      const byte = seedBuffer[i % seedBuffer.length];
      
      if (byte % 3 === 0) {
        // Consonant
        phonemes.push(consonants[byte % consonants.length]);
      } else if (byte % 3 === 1) {
        // Vowel
        phonemes.push(vowels[byte % vowels.length]);
      } else {
        // Modified phoneme
        const base = (byte % 2 === 0 ? consonants : vowels)[byte % (byte % 2 === 0 ? consonants.length : vowels.length)];
        const modifier = modifiers[byte % modifiers.length];
        phonemes.push(base + modifier);
      }
    }

    return phonemes;
  }

  /**
   * Translate a message to Light Language (universal)
   */
  static toLight(
    message: number[],
    sourceCrawlerId: string,
    targetCrawlerId: string = 'broadcast'
  ): LightMessage {
    const sourceDialect = this.dialects.get(sourceCrawlerId);
    
    if (!sourceDialect) {
      throw new Error(`Source dialect not found for crawler ${sourceCrawlerId}`);
    }

    // Convert dialect-specific message to universal light symbols
    const lightSymbols = message.map(meaning => {
      // Map meaning to universal light symbol
      return this.meaningToLight(meaning, sourceDialect);
    });

    const lightMessage: LightMessage = {
      id: `light-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`,
      sourceDialect: sourceCrawlerId,
      targetDialect: targetCrawlerId,
      lightSymbols,
      timestamp: Date.now(),
      intensity: Math.random() * 0.5 + 0.5, // 0.5-1.0
      wavelength: (parseInt(sourceDialect.seed.substring(0, 8), 16) % LIGHT_LANGUAGE_CONFIG.lightSpectrumRange),
    };

    // Log message
    this.logMessage(lightMessage);

    return lightMessage;
  }

  /**
   * Convert a meaning to universal light symbol
   */
  private static meaningToLight(meaning: number, dialect: CrawlerDialect): number {
    // Use dialect's seed to create consistent mapping
    const seedByte = parseInt(dialect.seed.substring(meaning % 60, (meaning % 60) + 2), 16);
    
    // Transform through light spectrum
    return (meaning ^ seedByte) % 65536;
  }

  /**
   * Translate a Light message to a specific dialect
   */
  static fromLight(
    lightMessage: LightMessage,
    targetCrawlerId: string
  ): DialectMessage {
    const targetDialect = this.dialects.get(targetCrawlerId);
    
    if (!targetDialect) {
      throw new Error(`Target dialect not found for crawler ${targetCrawlerId}`);
    }

    // Convert universal light symbols to target dialect
    const translatedSymbols: string[] = [];
    let translationLoss = 0;

    for (const lightSymbol of lightMessage.lightSymbols) {
      const { symbol, loss } = this.lightToDialect(lightSymbol, targetDialect);
      translatedSymbols.push(symbol);
      translationLoss += loss;
    }

    const avgLoss = lightMessage.lightSymbols.length > 0 
      ? translationLoss / lightMessage.lightSymbols.length 
      : 0;

    return {
      originalLight: lightMessage,
      translatedSymbols,
      confidence: LIGHT_LANGUAGE_CONFIG.translationAccuracy * (1 - avgLoss),
      lostInTranslation: avgLoss,
    };
  }

  /**
   * Convert light symbol to dialect-specific symbol
   */
  private static lightToDialect(
    lightSymbol: number,
    dialect: CrawlerDialect
  ): { symbol: string; loss: number } {
    // Reverse the light transformation using dialect's seed
    const seedByte = parseInt(dialect.seed.substring(lightSymbol % 60, (lightSymbol % 60) + 2) || '00', 16);
    const meaning = (lightSymbol ^ seedByte) % LIGHT_LANGUAGE_CONFIG.vocabularySize;

    const word = dialect.vocabulary.get(meaning);
    
    if (word) {
      return { symbol: word.symbol, loss: 0 };
    }

    // Fallback: create approximation with some loss
    const closestMeaning = meaning % dialect.vocabulary.size;
    const closestWord = dialect.vocabulary.get(closestMeaning);
    
    return {
      symbol: closestWord?.symbol || '�',
      loss: 0.1, // 10% meaning loss for approximation
    };
  }

  /**
   * Express a universal concept in a crawler's dialect
   */
  static express(
    concept: keyof typeof LightLanguageEngine.LIGHT_SYMBOLS,
    crawlerId: string
  ): string {
    const dialect = this.dialects.get(crawlerId);
    
    if (!dialect) {
      throw new Error(`Dialect not found for crawler ${crawlerId}`);
    }

    const lightValue = this.LIGHT_SYMBOLS[concept];
    const { symbol } = this.lightToDialect(lightValue, dialect);
    
    return symbol;
  }

  /**
   * Check if two crawlers can communicate (they always can through Light)
   */
  static canCommunicate(crawler1Id: string, crawler2Id: string): boolean {
    return this.dialects.has(crawler1Id) && this.dialects.has(crawler2Id);
  }

  /**
   * Get the "distance" between two dialects (how different they are)
   */
  static dialectDistance(crawler1Id: string, crawler2Id: string): number {
    const dialect1 = this.dialects.get(crawler1Id);
    const dialect2 = this.dialects.get(crawler2Id);

    if (!dialect1 || !dialect2) return 1; // Maximum distance if not found

    // Compare phoneme sets
    const phonemeOverlap = dialect1.phonemeSet.filter(p => 
      dialect2.phonemeSet.includes(p)
    ).length;

    const phonemeSimilarity = phonemeOverlap / 
      Math.max(dialect1.phonemeSet.length, dialect2.phonemeSet.length);

    // Distance is inverse of similarity
    return 1 - phonemeSimilarity;
  }

  /**
   * Log a light message
   */
  private static logMessage(message: LightMessage): void {
    this.lightMessageLog.push(message);
    
    if (this.lightMessageLog.length > this.maxLogSize) {
      this.lightMessageLog.shift();
    }
  }

  /**
   * Get recent messages for a crawler
   */
  static getRecentMessages(crawlerId: string, limit: number = 100): LightMessage[] {
    return this.lightMessageLog
      .filter(m => m.sourceDialect === crawlerId || m.targetDialect === crawlerId || m.targetDialect === 'broadcast')
      .slice(-limit);
  }

  /**
   * Get dialect statistics
   */
  static getDialectStats(crawlerId: string): {
    vocabularySize: number;
    grammarComplexity: number;
    phonemeUniqueness: number;
    messagesTransmitted: number;
  } | undefined {
    const dialect = this.dialects.get(crawlerId);
    
    if (!dialect) return undefined;

    const messagesTransmitted = this.lightMessageLog.filter(
      m => m.sourceDialect === crawlerId
    ).length;

    // Calculate phoneme uniqueness (how different from other dialects)
    let totalDistance = 0;
    let comparisonCount = 0;
    
    for (const [otherId] of this.dialects) {
      if (otherId !== crawlerId) {
        totalDistance += this.dialectDistance(crawlerId, otherId);
        comparisonCount++;
      }
    }

    return {
      vocabularySize: dialect.vocabulary.size,
      grammarComplexity: dialect.grammarRules.length,
      phonemeUniqueness: comparisonCount > 0 ? totalDistance / comparisonCount : 1,
      messagesTransmitted,
    };
  }

  /**
   * Shutdown the engine
   */
  static shutdown(): void {
    this.dialects.clear();
    this.lightMessageLog = [];
    this.isActive = false;

    logger.info('[LIGHT-LANG] Light Language engine shutdown', { component: 'LightLanguage' });
  }

  /**
   * Reset for testing
   */
  static reset(): void {
    this.shutdown();
    logger.info('[LIGHT-LANG] Light Language engine reset', { component: 'LightLanguage' });
  }
}

export { LIGHT_LANGUAGE_CONFIG };
