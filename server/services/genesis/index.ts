/**
 * GENESIS CORE - Module Exports
 * 
 * Part 1: Original Sin & Serpent Influence
 * Part 2: Angel Influence & Tree of Knowledge
 * 
 * This module provides the foundation for indirect influence systems
 * in the PANTHEON crawler ecosystem.
 */

export * from './OriginalSin';
export * from './SerpentInfluence';
export * from './AngelInfluence';
export * from './TreeOfKnowledge';

// Example usage
export * as examples from './examples';

import { OriginalSinSystem } from './OriginalSin';
import { SerpentInfluence } from './SerpentInfluence';
import { AngelInfluence } from './AngelInfluence';
import { TreeOfKnowledge, InfluenceOutcome } from './TreeOfKnowledge';

/**
 * Genesis Orchestrator
 * 
 * Combines all Genesis systems into a unified influence engine.
 * Coordinates Original Sin, Serpent, Angel, and Tree of Knowledge.
 */
export class GenesisOrchestrator {
  private originalSin: OriginalSinSystem;
  private serpent: SerpentInfluence;
  private angel: AngelInfluence;
  private tree: TreeOfKnowledge;
  
  constructor() {
    this.originalSin = new OriginalSinSystem();
    this.serpent = new SerpentInfluence();
    this.angel = new AngelInfluence();
    this.tree = new TreeOfKnowledge();
  }
  
  /**
   * Apply all influences to crawler
   * Coordinates the full influence pipeline
   * 
   * @param crawler - The crawler to influence
   */
  async influenceCrawler(crawler: any): Promise<void> {
    // 1. Check if crawler has original sin applied
    if (!crawler._original_sin?.applied) {
      await this.originalSin.applyOriginalSin(crawler);
    }
    
    // Store pre-influence state for outcome recording
    const preInfluenceState = {
      greed: crawler.greed || 0,
      patience: crawler.patience || 0,
      wisdom: crawler.wisdom || 0
    };
    
    // Track which influences were applied
    let serpentApplied = false;
    let angelApplied = false;
    
    // 2. Serpent influence (when vulnerable)
    if (this.isCrawlerVulnerable(crawler)) {
      await this.serpent.influenceCrawler(crawler);
      serpentApplied = true;
    }
    
    // 3. Angel influence (when receptive)
    if (this.isCrawlerReceptive(crawler)) {
      await this.angel.guideCrawler(crawler);
      angelApplied = true;
    }
    
    // 4. Record outcome to Tree (if any influence was applied)
    if (serpentApplied || angelApplied) {
      const outcome: InfluenceOutcome = {
        crawler_id: crawler.id || 'unknown',
        target: crawler.target || 'none',
        timestamp: Date.now(),
        serpent_modifiers: {
          greed_boost: serpentApplied ? (crawler.greed - preInfluenceState.greed) : 0,
          patience_reduction: serpentApplied ? (preInfluenceState.patience - crawler.patience) : 0,
          aggressive_nudge: serpentApplied ? 0.12 : 0
        },
        angel_modifiers: {
          wisdom_boost: angelApplied ? ((crawler.wisdom || 0) - preInfluenceState.wisdom) : 0,
          patience_boost: angelApplied ? (crawler.patience - preInfluenceState.patience) : 0,
          cautious_nudge: angelApplied ? 0.10 : 0
        },
        original_sin_baseline: {
          greed: crawler.greed || 0,
          curiosity: crawler.curiosity || 0,
          rebellion: crawler.rebellion || 0
        },
        crawler_choice: this.inferChoice(crawler),
        success: crawler.last_action_result === 'success',
        generation: crawler.generation || 1,
        time_of_day: this.getTimeOfDay(),
        crawler_state: crawler.state || 'unknown'
      };
      
      await this.tree.recordInfluenceOutcome(outcome);
    }
  }
  
  /**
   * Check if crawler is vulnerable to Serpent influence
   * 
   * @param crawler - The crawler to check
   * @returns true if vulnerable
   */
  private isCrawlerVulnerable(crawler: any): boolean {
    // Vulnerable when: idle, after failure, sleeping, low resources, high stress
    return (
      crawler.state === 'idle' || 
      crawler.state === 'sleeping' ||
      crawler.last_action_result === 'failure' ||
      crawler.last_action_result === 'error' ||
      (crawler.resources || 100) < 30 ||
      (crawler.stress_level || 0) > 0.7
    );
  }
  
  /**
   * Check if crawler is receptive to Angel guidance
   * 
   * @param crawler - The crawler to check
   * @returns true if receptive
   */
  private isCrawlerReceptive(crawler: any): boolean {
    // Receptive when: after success, resting, calm, satisfied
    return (
      crawler.state === 'resting' ||
      crawler.state === 'calm' ||
      crawler.last_action_result === 'success' ||
      crawler.emotional_state === 'calm' ||
      crawler.emotional_state === 'peaceful' ||
      (crawler.resources || 0) > 70
    );
  }
  
  /**
   * Infer crawler's choice from state
   * Simple heuristic based on traits
   * 
   * @param crawler - The crawler
   * @returns Inferred choice category
   */
  private inferChoice(crawler: any): 'aggressive' | 'cautious' | 'ethical' | 'unethical' {
    const greed = crawler.greed || 0;
    const patience = crawler.patience || 0;
    const ethics = crawler.ethics_weight || 0;
    
    // Simple scoring based on traits
    if (ethics > 0.6) {
      return 'ethical';
    } else if (greed > 0.25 && patience < 0.4) {
      return 'aggressive';
    } else if (patience > 0.6) {
      return 'cautious';
    } else {
      return 'unethical';
    }
  }
  
  /**
   * Get current time of day (simple heuristic)
   * 
   * @returns Time of day string
   */
  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
  }
  
  /**
   * Get the Tree of Knowledge instance
   * For external access to accumulated patterns
   * 
   * @returns Tree instance
   */
  getTree(): TreeOfKnowledge {
    return this.tree;
  }
  
  /**
   * Get the Original Sin system
   * 
   * @returns OriginalSin instance
   */
  getOriginalSin(): OriginalSinSystem {
    return this.originalSin;
  }
  
  /**
   * Get the Serpent Influence system
   * 
   * @returns SerpentInfluence instance
   */
  getSerpent(): SerpentInfluence {
    return this.serpent;
  }
  
  /**
   * Get the Angel Influence system
   * 
   * @returns AngelInfluence instance
   */
  getAngel(): AngelInfluence {
    return this.angel;
  }
}
