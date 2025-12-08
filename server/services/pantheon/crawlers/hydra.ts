import { BaseCrawler } from '../baseCrawler';
import { EntropySignature, CrawlerType, CrawlerTask, ExplorationResult } from '../core';
import { URL } from 'url';

/**
 * Pheromone trail - chemical breadcrumbs for path selection
 */
interface PheromoneTrail {
  path: string;
  strength: number;    // 0-1 (higher = more attractive)
  timestamp: Date;
}

/**
 * HYDRA CRAWLER - Adaptive Multi-Head Explorer
 * 
 * Named after the mythological hydra - when one head finds
 * a rich source, it spawns multiple new heads to explore.
 * 
 * Features:
 * - Dynamic head spawning (up to 5 concurrent)
 * - Pheromone-based pathfinding
 * - Richness assessment (JSON/tables/forms detection)
 * - Automatic pruning of dead heads
 */
export class HydraCrawler extends BaseCrawler {
  private pheromones: Map<string, PheromoneTrail> = new Map();
  private heads: HydraHead[] = [];
  private maxHeads = 5;

  constructor(task: CrawlerTask) {
    super(task, CrawlerType.HYDRA);
  }

  async execute(): Promise<EntropySignature[]> {
    const signatures: EntropySignature[] = [];
    
    // Spawn initial head if none exist
    if (this.heads.length === 0) {
      this.spawnHead(this.task.target);
    }
    
    // Process each head concurrently
    const explorationPromises = this.heads.map(head => head.explore());
    const results = await Promise.all(explorationPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      // Spawn new heads if source is rich and we have capacity
      if (result.richness > 0.7 && this.heads.length < this.maxHeads) {
        this.spawnHead(result.nextTarget);
        this.layPheromone(result.nextTarget, result.richness);
      }
      signatures.push(this.generateEntropySignature(result));
    }
    
    // Prune dead heads
    this.heads = this.heads.filter(h => h.alive);
    
    return signatures;
  }

  /**
   * Spawn new hydra head
   */
  private spawnHead(target: string) {
    if (!target) return;
    
    const head = new HydraHead(target, this.pheromones);
    this.heads.push(head);
  }

  /**
   * Lay pheromone trail (chemical breadcrumbs)
   * Trails evaporate after 60 seconds
   */
  private layPheromone(path: string, strength: number) {
    this.pheromones.set(path, { 
      path, 
      strength, 
      timestamp: new Date() 
    });
    
    // Evaporate old pheromones (60s lifetime)
    for (const [key, trail] of this.pheromones.entries()) {
      if (Date.now() - trail.timestamp.getTime() > 60000) {
        this.pheromones.delete(key);
      }
    }
  }
}

/**
 * HYDRA HEAD - Individual exploration unit
 */
class HydraHead {
  alive = true;

  constructor(
    private target: string,
    private pheromones: Map<string, PheromoneTrail>
  ) {}

  /**
   * Explore target and extract intelligence
   */
  async explore(): Promise<ExplorationResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(this.target, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'manual',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const html = await response.text();
      const links = this.extractLinks(html, this.target);
      const richness = this.assessRichness(html);
      
      return {
        target: this.target,
        richness,
        links: links.slice(0, 10), // Limit for efficiency
        nextTarget: this.selectNextTarget(links),
        statusCode: response.status,
        contentLength: html.length
      };
    } catch (error) {
      this.alive = false;
      return { 
        target: this.target, 
        richness: 0, 
        error: true,
        errorType: error instanceof Error ? error.message : 'unknown'
      };
    }
  }

  /**
   * Extract links from HTML
   */
  private extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    // Handle both quoted and unquoted href attributes
    const regex = /href=(?:["']([^"']+)["']|([^\s>]+))/gi;
    let match;
    
    while ((match = regex.exec(html)) !== null) {
      try {
        // Use the first capturing group that matched
        const href = match[1] || match[2];
        const url = new URL(href, baseUrl);
        
        // Only follow http/https links
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          links.push(url.href);
        }
      } catch {
        // Invalid URL, skip
      }
    }
    
    // Remove duplicates
    return [...new Set(links)];
  }

  /**
   * Assess data richness (0-1 score)
   * Higher score = more valuable target
   * 
   * Scoring:
   * - JSON data: +0.3
   * - Tables: +0.2
   * - Forms: +0.2
   * - Content density: +0.3
   */
  private assessRichness(html: string): number {
    // More robust JSON detection - look for JSON-like patterns
    const jsonPattern = /{[\s\S]*"[^"]+"\s*:\s*[^}]*}/;
    const hasJson = jsonPattern.test(html);
    const hasTable = html.includes('<table');
    const hasForm = html.includes('<form');
    const density = Math.min(html.length / 10000, 1); // Normalize by 10KB
    
    let score = 0;
    if (hasJson) score += 0.3;
    if (hasTable) score += 0.2;
    if (hasForm) score += 0.2;
    score += density * 0.3;
    
    return Math.min(score, 1);
  }

  /**
   * Select next target using pheromone trails
   * Follows strongest pheromone if available
   */
  private selectNextTarget(links: string[]): string {
    if (links.length === 0) return '';
    
    let bestLink = links[0];
    let bestStrength = 0;
    
    // Follow pheromone trails
    for (const link of links) {
      const trail = this.pheromones.get(link);
      if (trail && trail.strength > bestStrength) {
        bestLink = link;
        bestStrength = trail.strength;
      }
    }
    
    return bestLink;
  }
}
