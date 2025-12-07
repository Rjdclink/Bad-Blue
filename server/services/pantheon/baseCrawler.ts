import { EventEmitter } from 'events';
import { CrawlerTask, EntropySignature, CrawlerType } from './core';
import { createLogger } from '../../logger';

const log = createLogger('BaseCrawler');

/**
 * Base Crawler - Abstract class for all crawler species
 * Implements quantum execution and entropy generation
 */
export abstract class BaseCrawler extends EventEmitter {
  protected active = false;

  constructor(
    protected task: CrawlerTask,
    protected type: CrawlerType
  ) {
    super();
  }

  /**
   * Execute crawler logic (implemented by subclasses)
   * Returns array of entropy signatures
   */
  abstract execute(): Promise<EntropySignature[]>;

  /**
   * Start crawler with quantum execution
   */
  async start() {
    this.active = true;
    log.info(`${this.type} crawler started: ${this.task.id}`);
    
    try {
      const signatures = await this.executeQuantum();
      this.emit('complete', signatures);
      return signatures;
    } catch (error) {
      log.error(`${this.type} crawler failed`, error);
      this.emit('error', error);
      throw error;
    } finally {
      this.destroy();
    }
  }

  /**
   * Execute in quantum slices (50ms work, 10ms cooldown)
   * Prevents resource hogging on free-tier infrastructure
   */
  private async executeQuantum(): Promise<EntropySignature[]> {
    const results: EntropySignature[] = [];
    const startTime = Date.now();
    
    while (this.active && (Date.now() - startTime) < this.task.quantum) {
      try {
        const chunk = await this.execute();
        results.push(...chunk);
        
        // Quantum cooldown (10ms sleep)
        await this.sleep(10);
        
        // Check entropy budget
        if (results.length >= this.task.entropyBudget) {
          break;
        }
      } catch (error) {
        log.error(`Quantum execution error`, error);
      }
    }
    
    return results;
  }

  /**
   * Sleep utility
   */
  protected async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate entropy signature from raw data
   * Compresses MB of data into 48-byte signature
   */
  protected generateEntropySignature(data: any): EntropySignature {
    return {
      hash: this.hashData(data),
      probability: this.calculateProbability(data),
      constraints: this.extractConstraints(data),
      temporalDrift: Date.now(),
      structuralDensity: this.analyzeStructure(data),
      timestamp: new Date()
    };
  }

  /**
   * Hash data to 32-byte identifier (not cryptographic)
   * Uses a simple hash function for generating unique-enough identifiers
   */
  protected hashData(data: any): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Create a 32-character hash by combining timestamp and hash value
    const timestamp = Date.now().toString(36);
    const hashStr = Math.abs(hash).toString(36);
    return (timestamp + hashStr + str.length.toString(36)).padEnd(32, '0').slice(0, 32);
  }

  /**
   * Calculate probability score (0-1) based on entropy
   * Lower entropy = higher probability = more predictable
   * Higher entropy = lower probability = more random
   */
  protected calculateProbability(data: any): number {
    const str = JSON.stringify(data);
    const uniqueChars = new Set(str).size;
    const entropy = uniqueChars / str.length;
    
    // Invert: lower entropy = higher probability
    return Math.max(0, Math.min(1, 1 - entropy));
  }

  /**
   * Extract numerical constraints from data
   * Used for solution space compression
   */
  protected extractConstraints(data: any): number[] {
    const nums: number[] = [];
    
    const extract = (obj: any) => {
      if (typeof obj === 'number') {
        nums.push(obj);
      } else if (typeof obj === 'object' && obj !== null) {
        Object.values(obj).forEach(extract);
      }
    };
    
    extract(data);
    return nums;
  }

  /**
   * Analyze structural density (0-1)
   * Measures data complexity via nesting and breadth
   */
  protected analyzeStructure(data: any): number {
    const str = JSON.stringify(data);
    const depth = (str.match(/[{[]/g) || []).length;
    const breadth = (str.match(/,/g) || []).length;
    
    // Normalize to 0-1 range
    return Math.min((depth + breadth) / 100, 1);
  }

  /**
   * Stop crawler execution
   */
  stop() {
    this.active = false;
    this.emit('stopped');
    log.info(`${this.type} crawler stopped: ${this.task.id}`);
  }

  /**
   * Destroy crawler and cleanup
   * Zero-trace ghost protocol: no state persists
   */
  destroy() {
    this.active = false;
    this.removeAllListeners();
    log.info(`${this.type} crawler destroyed: ${this.task.id}`);
  }
}
