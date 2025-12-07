/**
 * PANTHEON BASE CRAWLER (Part 1/4)
 * 
 * Abstract base class for all PANTHEON crawlers.
 * Provides common functionality for entropy signature generation,
 * sleep utilities, and lifecycle management.
 */

import { CrawlerType, CrawlerTask, EntropySignature, CrawlerResult } from './core';
import { randomBytes } from 'crypto';

export abstract class BaseCrawler {
  protected startTime: number = 0;
  
  constructor(
    protected task: CrawlerTask,
    protected crawlerType: CrawlerType
  ) {}

  /**
   * Execute the crawler task - must be implemented by subclasses
   */
  abstract execute(): Promise<EntropySignature[]>;

  /**
   * Run the crawler and return results
   */
  async run(): Promise<CrawlerResult> {
    this.startTime = Date.now();
    
    try {
      const signatures = await this.execute();
      
      return {
        taskId: this.task.id,
        crawlerType: this.crawlerType,
        signatures,
        executionTime: Date.now() - this.startTime,
        success: true
      };
    } catch (error) {
      return {
        taskId: this.task.id,
        crawlerType: this.crawlerType,
        signatures: [],
        executionTime: Date.now() - this.startTime,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate entropy signature from raw data
   */
  protected generateEntropySignature(data: any): EntropySignature {
    // Calculate entropy based on data complexity
    const entropy = this.calculateEntropy(data);
    
    return {
      id: this.generateId(),
      type: data.type || 'unknown',
      source: this.crawlerType,
      timestamp: new Date(),
      entropy,
      metadata: data,
      confidence: data.confidence || 0.5
    };
  }

  /**
   * Calculate entropy score (0-1) based on data complexity
   */
  private calculateEntropy(data: any): number {
    const dataStr = JSON.stringify(data);
    const length = dataStr.length;
    const uniqueChars = new Set(dataStr).size;
    
    // Simple entropy calculation: uniqueness * length factor
    const uniqueness = uniqueChars / 256; // Normalize by max possible chars
    const lengthFactor = Math.min(length / 1000, 1); // Normalize by 1KB
    
    return (uniqueness + lengthFactor) / 2;
  }

  /**
   * Generate unique ID for entropy signature
   */
  private generateId(): string {
    return `${this.crawlerType}-${Date.now()}-${randomBytes(8).toString('hex')}`;
  }

  /**
   * Sleep utility for crawler throttling
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if task has timed out
   */
  protected hasTimedOut(): boolean {
    if (!this.task.timeout) return false;
    return (Date.now() - this.startTime) > this.task.timeout;
  }
}
